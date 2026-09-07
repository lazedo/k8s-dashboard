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

Every `api/v1/...` endpoint accepts a `cluster=<name>` query parameter. When present, the backend serves the
request from the cluster whose kubeconfig is stored in the local cluster, in the Secret `kubeconfig-<name>`
(data key `value`, or `value.yaml`) or in a Secret labelled `dashboard.k8s.io/cluster=<name>`, in the namespace
given by `--remote-kubeconfig-namespace` (default `flux-system`). This is the layout Flux uses for
`kubeConfig.secretRef`, so a hub cluster running Flux already has one Secret per site; without the parameter the
request is served by the local cluster as before.

Authorization: the Secret is read with the credentials of the dashboard user making the request. Whoever may
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

`GET api/v1/clusters` lists the available clusters, for a selector:

```json
{"clusters": [
  {"name": "west", "server": "https://west.example:6443", "accessible": true},
  {"name": "east", "server": "https://east.example:6443", "accessible": false}
]}
```

`accessible` tells whether the current user may read the Secret. The list is built with the dashboard service
account, which therefore needs `list` on Secrets in that namespace (a `Role`/`RoleBinding` in `flux-system`);
when it has no such grant the caller's own credentials are used to list instead.

A plugin reads a remote object by adding the parameter to the call, e.g. the Kazoo CRs living in the `west` site:

```ts
fetch('api/v1/crd/%20/kazoos.cluster.kazoo.io/object?cluster=west', {headers: {Accept: 'application/json'}})
```

Plugins using the dashboard's Angular `HttpClient` do not need to: when the plugin route is opened as
`#/plugin/<name>?cluster=west`, the HTTP interceptor appends `cluster=west` to every `api/v1/...` call that does
not name a cluster itself. Plain `fetch` calls bypass the interceptor and must pass the parameter explicitly.

----
_Copyright 2021 [The Kubernetes Dashboard Authors](https://github.com/kubernetes/dashboard/graphs/contributors)_