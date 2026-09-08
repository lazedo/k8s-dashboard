# Plugin Docs

* [Installation](#installation)
* [Compiling Plugins](#compiling-plugins)
* [Registering Plugin](#registering-plugin)
* [Creating ConfigMap](#creating-configmap)
* [Remote clusters](#remote-clusters)

### Installation

To enable plugin support in the dashboard you must register a custom [CRD](../../aio/test-resources/plugin-crd.yml) in your cluster.

```shell
kubectl apply -f https://raw.githubusercontent.com/kubernetes/dashboard/master/aio/test-resources/plugin-crd.yml
```

### Compiling Plugins

In order to take advantage of AOT compilation, sharing the code across plugins and not ship the core Angular packages with the plugin bundle, there is a custom build process to compile the plugins.
You can clone this repository and checkout to [`plugin/base`](https://github.com/kubernetes/dashboard/tree/plugin/base) branch. The build process is specified under [`builders`](https://github.com/kubernetes/dashboard/tree/plugin/base/builders) directory.

On this branch, you can compile the plugin with following command

```shell
ng build plugin && ng build --project custom-plugin --prod --modulePath="k8s-plugin#PluginModule" --pluginName="k8s-plugin" --outputPath="./dist/bundle"
ng build --project custom-plugin --prod --modulePath="./plugin1/plugin1.module#Plugin1Module" --pluginName="plugin1" --sharedLibs="k8s-plugin" --outputPath="./dist/bundle"
```

The key thing here is that we specify the `custom-plugin` project in the `angular.json` to use our custom builder. Make sure to keep the config similar when developing your own plugins.

### Registering Plugin

Once the custom CRD is registered we can now create [instances](../../aio/test-resources/plugin-test.yml) of the CRD which will hold the spec for plugin.

```shell
kubectl apply -f https://raw.githubusercontent.com/kubernetes/dashboard/master/aio/test-resources/plugin-test.yml
```

> Note: The backend reads the compiled plugin source from a ConfigMap and we need to create that also.

### Creating ConfigMap

We can now create config-maps to hold the compiled plugin source code.

```shell
kubectl create configmap k8s-plugin-src --from-file="./dist/bundle/k8s-plugin.js"
kubectl create configmap plugin1-src --from-file="./dist/bundle/plugin1.js"
```

After following all the above steps, your new plugin should be available in the dashboard.

### Remote clusters

Every `api/v1/<request>` endpoint is also served as `api/v1/cluster/<name>/<request>`, by the cluster
called `<name>`:

* `local`, or the name given to the backend by `--cluster-name` (default `local`): the local cluster, exactly
  as without the prefix. No prefix at all also means the local cluster.
* any other name: the remote cluster whose kubeconfig is stored in the local cluster, in the Secret
  `kubeconfig-<name>` (data key `value`, or `value.yaml`) or in a Secret labelled `dashboard.k8s.io/cluster=<name>`,
  in the namespace given by `--remote-kubeconfig-namespace` (default `flux-system`). This is the layout Flux uses
  for `kubeConfig.secretRef`, so a hub cluster running Flux already has one Secret per site. An unknown name
  answers `404 {"message": "unknown cluster <name>"}`.

The cluster is never a query parameter: `?cluster=` is not read anywhere. The path is the only way to address a
cluster, so a URL always says which cluster a request acts on.

Some endpoints describe this dashboard rather than a cluster's workload and are served by the hub only, never
under the prefix (404): `plugin`, `globalplugin`, `settings`, `login`, `token`, `csrftoken`, `systembanner`,
`clusters`, `me`.

Authorization has two halves:

1. The kubeconfig Secret is read with the credentials of the dashboard user making the request. Whoever may
   `get` that Secret in the local cluster may use the kubeconfig inside it, nobody else. Grant it with RBAC, e.g.

   ```yaml
   apiVersion: rbac.authorization.k8s.io/v1
   kind: Role
   metadata:
     name: remote-cluster-west
     namespace: flux-system
   rules:
     - apiGroups: [""]
       resources: ["secrets"]
       resourceNames: ["kubeconfig-west"]
       verbs: ["get"]
   ```

2. **Impersonation.** The remote request is made with the kubeconfig's credentials impersonating the caller:
   `Impersonate-User` is the user name the local apiserver attributes to the request's token (with the
   apiserver's OIDC prefix, e.g. `dex#<sub>`) and `Impersonate-Group` its groups (e.g. `dex#myorg:admins`),
   as answered by a `SelfSubjectReview` on the local cluster; `system:authenticated` is left out, the remote
   apiserver adds it itself. A remote request without an authenticated caller answers `401`. On a hub older than
   Kubernetes 1.28 (no `SelfSubjectReview` API) the identity is read from the id_token claims instead: `sub` as
   user name and `groups` as groups, unprefixed.

   Prerequisites on the remote cluster: the kubeconfig's service account needs `impersonate` on `users` and
   `groups` (and needs nothing else), and the impersonated user/groups need their own bindings there. With the
   same identity provider on both sides (same OIDC issuer, username/groups prefixes and groups claim), the
   bindings are the ones the user would have with `kubectl` against that cluster.

   ```yaml
   apiVersion: rbac.authorization.k8s.io/v1
   kind: ClusterRole
   metadata:
     name: dashboard-impersonator
   rules:
     - apiGroups: [""]
       resources: ["users", "groups"]
       verbs: ["impersonate"]
   ```

`GET api/v1/clusters` lists the clusters, the local one first, for the selector of the top bar:

```json
{"clusters": [
  {"name": "hub", "local": true, "server": "https://hub.example:6443", "accessible": true},
  {"name": "west", "local": false, "server": "https://west.example:6443", "accessible": true},
  {"name": "east", "local": false, "server": "https://east.example:6443", "accessible": false}
]}
```

`accessible` tells whether the current user may read the Secret. The list is built with the dashboard service
account, which therefore needs `list` on Secrets in that namespace (a `Role`/`RoleBinding` in `flux-system`);
when it has no such grant the caller's own credentials are used to list instead. A Secret registered under the
local cluster's name is not listed: that name always resolves to the local cluster.

#### The selected cluster in the dashboard

The cluster the dashboard is looking at is dashboard state, held like the namespace: in the `cluster` route query
param (`#/overview?cluster=west&namespace=default`; absent = local), copied into `ClusterService` by the cluster
selector of the top bar (left of the namespace selector, hidden when only the local cluster exists) and kept
across navigation by the nav items. While a remote cluster is selected the top bar is amber and shows the cluster
name as a badge. Picking a cluster opens its overview in the default namespace.

The HTTP interceptor rewrites every `api/v1/...` call made through Angular's `HttpClient` to the
`api/v1/cluster/<name>/...` form while a remote cluster is selected, except the hub-only endpoints above and
calls carrying the `HUB_ONLY` context token. Plain `fetch` calls bypass the interceptor: plugins address the
cluster through `window.kdCluster`.

#### `window.kdCluster`

```ts
window.kdCluster.current()  // name of the selected cluster (the local cluster's name when none is selected)
window.kdCluster.local()    // name of the local cluster (--cluster-name)
window.kdCluster.isLocal()  // true when the dashboard is looking at its own cluster
window.kdCluster.list()     // [{name, local, accessible, server}], as GET api/v1/clusters
window.kdCluster.path(rest: string, cluster?: string): string
```

`path` is the way a plugin builds a backend URL: for `rest = 'crd/%20/kazoos.cluster.kazoo.io/object'` it
returns `api/v1/crd/%20/kazoos.cluster.kazoo.io/object` when the target is the local cluster and
`api/v1/cluster/west/crd/%20/kazoos.cluster.kazoo.io/object` when it is `west`. Without the second argument
the selected cluster is used, so a plugin that follows the dashboard's context simply wraps its URLs:

```ts
fetch(window.kdCluster.path('crd/%20/kazoos.cluster.kazoo.io/object'), {headers: {Accept: 'application/json'}})
```

and a plugin that fans out to every site names each one:

```ts
for (const cluster of window.kdCluster.list().filter(c => c.accessible)) {
  fetch(window.kdCluster.path('crd/%20/kazoos.cluster.kazoo.io/object', cluster.name));
}
```

----
_Copyright 2021 [The Kubernetes Dashboard Authors](https://github.com/kubernetes/dashboard/graphs/contributors)_