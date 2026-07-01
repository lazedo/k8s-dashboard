// Copyright 2024 The Kubernetes Authors.
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

package deployment

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"path/filepath"
	"strings"
	"time"

	"sigs.k8s.io/kustomize/api/krusty"
	"sigs.k8s.io/kustomize/api/types"
	"sigs.k8s.io/kustomize/kyaml/filesys"
)

const (
	fetchTimeout = 20 * time.Second
	fetchMaxSize = 10 << 20 // 10 MiB
)

// fetchDeployContent returns the manifest YAML to apply from a URL. A single
// manifest is fetched verbatim; a directory / kustomization.yaml (or when the
// caller forces it) is rendered with kustomize.
func fetchDeployContent(rawURL string, kustomize bool) (string, error) {
	if kustomize || isKustomizeURL(rawURL) {
		return buildKustomize(rawURL)
	}
	return httpGetString(rawURL)
}

// isKustomizeURL reports whether a URL should be built with kustomize: it points
// at a kustomization file, or has no manifest extension (i.e. a directory).
func isKustomizeURL(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	if isKustomizationFile(path.Base(u.Path)) {
		return true
	}
	switch strings.ToLower(path.Ext(u.Path)) {
	case ".yaml", ".yml", ".json":
		return false
	default:
		return true
	}
}

func isKustomizationFile(name string) bool {
	return name == "kustomization.yaml" || name == "kustomization.yml" || name == "Kustomization"
}

func httpGetString(rawURL string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return "", fmt.Errorf("invalid or unsupported URL: %s", rawURL)
	}
	client := &http.Client{Timeout: fetchTimeout}
	resp, err := client.Get(rawURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GET %s: %s", rawURL, resp.Status)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, fetchMaxSize))
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// buildKustomize renders a kustomization from a URL. A kustomize remote-git
// target (github.com/org/repo//overlays?ref=main, git::…) is built with
// kustomize's native loader, which clones via the git binary. A plain raw URL
// (e.g. raw.githubusercontent.com/.../kustomization.yaml) is built over HTTP with
// a read-only filesystem rooted at the host, so relative bases/overlays resolve
// to sibling URLs without needing git or local disk.
func buildKustomize(rawURL string) (string, error) {
	opts := krusty.MakeDefaultOptions()
	opts.LoadRestrictions = types.LoadRestrictionsNone // allow ../ across the root
	k := krusty.MakeKustomizer(opts)

	if isGitTarget(rawURL) {
		return renderKustomization(k, filesys.MakeFsOnDisk(), withGitDefaults(rawURL))
	}

	u, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("unsupported URL scheme %q", u.Scheme)
	}

	target := u.Path
	if isKustomizationFile(path.Base(target)) {
		target = path.Dir(target)
	}
	return renderKustomization(k, newHTTPFileSystem(u.Scheme+"://"+u.Host), target)
}

func renderKustomization(k *krusty.Kustomizer, fSys filesys.FileSystem, target string) (string, error) {
	m, err := k.Run(fSys, target)
	if err != nil {
		return "", err
	}
	yml, err := m.AsYaml()
	if err != nil {
		return "", err
	}
	return string(yml), nil
}

// withGitDefaults adds kustomize clone params that keep remote builds fast and
// predictable: skip submodules (rare in overlays and slow/recursive) and use a
// generous timeout, unless the caller already set them.
func withGitDefaults(rawURL string) string {
	sep := "?"
	if strings.Contains(rawURL, "?") {
		sep = "&"
	}
	extra := ""
	if !strings.Contains(rawURL, "submodules=") {
		extra += sep + "submodules=false"
		sep = "&"
	}
	if !strings.Contains(rawURL, "timeout=") {
		extra += sep + "timeout=120"
	}
	return rawURL + extra
}

// isGitTarget reports whether a URL is a kustomize remote-git target (built by
// cloning) rather than a raw content URL (fetched over HTTP).
func isGitTarget(rawURL string) bool {
	if strings.HasPrefix(rawURL, "git::") {
		return true
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	switch strings.ToLower(u.Host) {
	case "github.com", "gitlab.com", "bitbucket.org":
		return true
	}
	if strings.HasSuffix(strings.ToLower(u.Host), ".googlesource.com") {
		return true
	}
	// kustomize's repo//path separator, or a git ref/version query.
	if strings.Contains(u.Path, "//") {
		return true
	}
	q := u.Query()
	return q.Has("ref") || q.Has("version") || q.Has("timeout")
}

// httpFileSystem is a read-only filesys.FileSystem that resolves paths to HTTP(S)
// URLs under a fixed scheme://host root. Only the read methods kustomize uses to
// load a kustomization are backed by real fetches; mutation methods are errors.
type httpFileSystem struct {
	root   string
	client *http.Client
	cache  map[string][]byte
	misses map[string]bool
}

func newHTTPFileSystem(root string) *httpFileSystem {
	return &httpFileSystem{
		root:   strings.TrimRight(root, "/"),
		client: &http.Client{Timeout: fetchTimeout},
		cache:  map[string][]byte{},
		misses: map[string]bool{},
	}
}

func (fs *httpFileSystem) fetch(p string) ([]byte, error) {
	clean := path.Clean("/" + p)
	if b, ok := fs.cache[clean]; ok {
		return b, nil
	}
	if fs.misses[clean] {
		return nil, fmt.Errorf("not found: %s", clean)
	}
	resp, err := fs.client.Get(fs.root + clean)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fs.misses[clean] = true
		return nil, fmt.Errorf("GET %s%s: %s", fs.root, clean, resp.Status)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, fetchMaxSize))
	if err != nil {
		return nil, err
	}
	fs.cache[clean] = b
	return b, nil
}

func (fs *httpFileSystem) ReadFile(p string) ([]byte, error) { return fs.fetch(p) }

func (fs *httpFileSystem) Exists(p string) bool {
	if _, err := fs.fetch(p); err == nil {
		return true
	}
	// A directory "exists" if it holds a kustomization file.
	for _, name := range []string{"kustomization.yaml", "kustomization.yml", "Kustomization"} {
		if _, err := fs.fetch(path.Join(p, name)); err == nil {
			return true
		}
	}
	return false
}

func (fs *httpFileSystem) IsDir(p string) bool {
	return filepath.Ext(p) == ""
}

func (fs *httpFileSystem) CleanedAbs(p string) (filesys.ConfirmedDir, string, error) {
	clean := path.Clean("/" + p)
	if fs.IsDir(clean) {
		return filesys.ConfirmedDir(clean), "", nil
	}
	return filesys.ConfirmedDir(path.Dir(clean)), path.Base(clean), nil
}

func (fs *httpFileSystem) ReadDir(string) ([]string, error) { return nil, nil }
func (fs *httpFileSystem) Glob(string) ([]string, error)    { return nil, nil }

// Mutation / streaming operations are unsupported: kustomize does not use them to
// load, and the remote filesystem is read-only.
func (fs *httpFileSystem) Create(string) (filesys.File, error)  { return nil, errReadOnlyFS }
func (fs *httpFileSystem) Mkdir(string) error                   { return errReadOnlyFS }
func (fs *httpFileSystem) MkdirAll(string) error                { return errReadOnlyFS }
func (fs *httpFileSystem) RemoveAll(string) error               { return errReadOnlyFS }
func (fs *httpFileSystem) Open(string) (filesys.File, error)    { return nil, errReadOnlyFS }
func (fs *httpFileSystem) WriteFile(string, []byte) error       { return errReadOnlyFS }
func (fs *httpFileSystem) Walk(string, filepath.WalkFunc) error { return errReadOnlyFS }

var errReadOnlyFS = fmt.Errorf("remote http filesystem is read-only")
