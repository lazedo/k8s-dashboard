// Copyright 2026 The Kubernetes Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"sync"
	"time"

	restful "github.com/emicklei/go-restful/v3"
	authenticationv1 "k8s.io/api/authentication/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/kubernetes/dashboard/src/app/backend/client"
	clientapi "github.com/kubernetes/dashboard/src/app/backend/client/api"
	"github.com/kubernetes/dashboard/src/app/backend/errors"
)

// Identity is the caller as the local cluster knows it: the user name and groups the local apiserver
// attributes to the credentials of the request. It is what gets impersonated on remote clusters, so a remote
// cluster sharing the hub's identity provider (same OIDC issuer, prefixes and groups claim) applies its own
// RBAC to the very same subject, e.g. user 'dex#<sub>' in group 'dex#myorg:admins'.
//
// The identity is asked to the local apiserver with a SelfSubjectReview made with the request's own
// credentials (the oauth2-proxy injected id_token, or the dashboard's own token): that answer already carries
// the apiserver's username/groups prefixes, which the raw token claims do not. On clusters without the
// SelfSubjectReview API (before Kubernetes 1.28) the identity falls back to the id_token claims read the way
// handleMe reads them: 'sub' as user name (the apiserver's default username claim) and 'groups' as groups,
// unprefixed.
type Identity struct {
	Username string
	Groups   []string
}

const (
	// identityCacheTTL bounds how long a resolved identity is reused for the same credentials.
	identityCacheTTL = 2 * time.Minute
	// identityCacheMaxEntries bounds the cache; it is flushed when exceeded.
	identityCacheMaxEntries = 4096
	// authenticatedGroup is added to every impersonated user by the apiserver itself, so it is not requested.
	authenticatedGroup = "system:authenticated"
)

type identityEntry struct {
	identity *Identity
	expires  time.Time
}

// callerClientFunc builds a local-cluster client with the credentials of the request itself.
type callerClientFunc func(req *http.Request) (kubernetes.Interface, error)

// identityCache resolves and caches the identity behind a request's credentials, keyed by a digest of them.
type identityCache struct {
	clientFor callerClientFunc
	now       func() time.Time

	lock    sync.Mutex
	entries map[string]identityEntry
}

func newIdentityCache(clientFor callerClientFunc) *identityCache {
	return &identityCache{clientFor: clientFor, now: time.Now, entries: map[string]identityEntry{}}
}

// callerClient builds the client the identity is asked with: from the request's own token, whatever the
// dashboard's login mode. In insecure mode the regular clients run as the dashboard service account, and that
// is not who must be impersonated on a remote cluster.
func callerClient(cManager clientapi.ClientManager) callerClientFunc {
	return func(req *http.Request) (kubernetes.Interface, error) {
		cmdConfig, err := cManager.ClientCmdConfig(restful.NewRequest(req))
		if err != nil {
			return nil, err
		}

		cfg, err := cmdConfig.ClientConfig()
		if err != nil {
			return nil, err
		}

		return kubernetes.NewForConfig(cfg)
	}
}

// resolve returns the identity behind the request's credentials, unauthorized when it carries none.
func (cache *identityCache) resolve(req *http.Request) (*Identity, error) {
	key := credentialsKey(req)
	if len(key) == 0 {
		return nil, errors.NewUnauthorized("a remote cluster needs an authenticated caller to impersonate")
	}

	if identity := cache.get(key); identity != nil {
		return identity, nil
	}

	identity, err := cache.lookup(req)
	if err != nil {
		return nil, err
	}

	cache.put(key, identity)
	return identity, nil
}

// lookup asks the local apiserver who the caller is, falling back to the token claims where the API is absent.
func (cache *identityCache) lookup(req *http.Request) (*Identity, error) {
	k8sClient, err := cache.clientFor(req)
	if err != nil {
		return nil, err
	}

	review, err := k8sClient.AuthenticationV1().SelfSubjectReviews().Create(req.Context(),
		&authenticationv1.SelfSubjectReview{}, metav1.CreateOptions{})
	if err == nil {
		return identityFromUserInfo(review.Status.UserInfo), nil
	}

	if !k8serrors.IsNotFound(err) {
		return nil, err
	}

	identity := identityFromClaims(parseJWTClaims(bearerToken(req.Header.Get("Authorization"))))
	if identity == nil {
		return nil, errors.NewUnauthorized("cannot tell who the caller is: no SelfSubjectReview API and no usable token claims")
	}

	return identity, nil
}

func identityFromUserInfo(info authenticationv1.UserInfo) *Identity {
	groups := make([]string, 0, len(info.Groups))
	for _, group := range info.Groups {
		if group != authenticatedGroup {
			groups = append(groups, group)
		}
	}

	return &Identity{Username: info.Username, Groups: groups}
}

// identityFromClaims derives the identity from id_token claims: 'sub' and 'groups'. Nil without a subject.
func identityFromClaims(claims map[string]interface{}) *Identity {
	subject := stringClaim(claims, "sub")
	if len(subject) == 0 {
		return nil
	}

	groups := []string{}
	if values, ok := claims["groups"].([]interface{}); ok {
		for _, value := range values {
			if group, ok := value.(string); ok && len(group) > 0 && group != authenticatedGroup {
				groups = append(groups, group)
			}
		}
	}

	return &Identity{Username: subject, Groups: groups}
}

// credentialsKey digests the credentials of the request; empty when it carries none.
func credentialsKey(req *http.Request) string {
	authorization := req.Header.Get("Authorization")
	jweToken := req.Header.Get(client.JWETokenHeader)
	if len(authorization) == 0 && len(jweToken) == 0 {
		return ""
	}

	sum := sha256.Sum256([]byte(authorization + "\n" + jweToken))
	return hex.EncodeToString(sum[:])
}

func (cache *identityCache) get(key string) *Identity {
	cache.lock.Lock()
	defer cache.lock.Unlock()

	if entry, ok := cache.entries[key]; ok && cache.now().Before(entry.expires) {
		return entry.identity
	}

	return nil
}

func (cache *identityCache) put(key string, identity *Identity) {
	cache.lock.Lock()
	defer cache.lock.Unlock()

	if len(cache.entries) >= identityCacheMaxEntries {
		cache.entries = map[string]identityEntry{}
	}

	cache.entries[key] = identityEntry{identity: identity, expires: cache.now().Add(identityCacheTTL)}
}
