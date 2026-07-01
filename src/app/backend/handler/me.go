// Copyright 2017 The Kubernetes Authors.
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
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"

	restful "github.com/emicklei/go-restful/v3"
)

// User is the authenticated identity behind the current request, derived from the
// bearer token's claims. When Dashboard sits behind an OIDC-terminating proxy (e.g.
// oauth2-proxy), the injected id_token already carries name/email/picture, so no
// OIDC handling is needed here — we just read the claims.
type User struct {
	Name          string `json:"name,omitempty"`
	Email         string `json:"email,omitempty"`
	Picture       string `json:"picture,omitempty"`
	Authenticated bool   `json:"authenticated"`
}

// handleMe returns the identity behind the Authorization bearer token.
func (apiHandler *APIHandler) handleMe(request *restful.Request, response *restful.Response) {
	token := bearerToken(request.HeaderParameter("Authorization"))
	claims := parseJWTClaims(token)

	user := &User{
		Name: firstNonEmpty(
			stringClaim(claims, "name"),
			stringClaim(claims, "preferred_username"),
			stringClaim(claims, "email"),
			stringClaim(claims, "sub"),
		),
		Email:         stringClaim(claims, "email"),
		Picture:       stringClaim(claims, "picture"),
		Authenticated: token != "",
	}
	_ = response.WriteHeaderAndEntity(http.StatusOK, user)
}

func bearerToken(authHeader string) string {
	if strings.HasPrefix(authHeader, "Bearer ") {
		return strings.TrimPrefix(authHeader, "Bearer ")
	}
	return ""
}

// parseJWTClaims decodes (without verifying) the claims of a JWT. The token was
// already validated by the apiserver / auth proxy; here we only read its payload.
func parseJWTClaims(token string) map[string]interface{} {
	claims := map[string]interface{}{}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return claims
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return claims
	}
	_ = json.Unmarshal(payload, &claims)
	return claims
}

func stringClaim(claims map[string]interface{}, key string) string {
	if v, ok := claims[key].(string); ok {
		return v
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
