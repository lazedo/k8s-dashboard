# Form Plugins

Form plugins add cards to the dashboard's **Create → From form** gallery. Each
card opens a guided HTML form for one kind of resource. The stock cards
(Application, Custom resource) and cluster-provided cards run through the same
contract, so anything described here behaves exactly like the built-ins.

A form plugin is **framework-agnostic by design**: the dashboard hands your
script a plain DOM element and a `ctx` object. You can write vanilla JS,
TypeScript, preact, lit — anything that compiles to a single script — with no
coupling to the dashboard's Angular version.

## The pieces

| Piece | Owner | What it does |
| --- | --- | --- |
| Card + gallery | dashboard | lists cards; opens/closes forms |
| Action bar (buttons below the form) | dashboard | renders the buttons your script declares; routes clicks back to you |
| Form body | **your script** | arbitrary HTML rendered into `host` |
| Cluster writes | dashboard | `ctx.submit()` goes through the dashboard's create service with the logged-in user's credentials — scripts never talk to the API server directly |

## The FormPlugin custom resource

```yaml
apiVersion: dashboard.k8s.io/v1alpha1
kind: FormPlugin           # cluster-scoped
metadata:
  name: my-form
spec:
  title: My Form           # card title (required)
  description: One liner shown on the card.
  icon: dynamic_form       # Material icon name
  script: |                # JavaScript, signature (host, ctx)  (required)
    'use strict';
    host.innerHTML = '...';
  args:                    # optional; passed verbatim as ctx.args
    anything: goes
```

The dashboard lists `formplugins.dashboard.k8s.io` at gallery load and adds one
card per object. Users need RBAC `get`/`list` on `formplugins` to see the cards.

## The script contract

Your script body is executed as `function (host, ctx)`:

- `host` — an empty `<div class="kd-form-plugin-host">` inside the card. Render
  whatever you want into it.
- `ctx` — the dashboard API:

```ts
interface FormPluginCtx {
  namespace: string;                       // currently selected namespace
  args: {};                                // spec.args from the CR (or {})
  http: {
    get(url: string): Promise<{}>;         // authenticated dashboard API calls
    post(url: string, body: {}): Promise<{}>;
  };
  buttons: {
    set(specs: ButtonSpec[]): void;        // declare the action bar
    patch(id: string, patch: Partial<ButtonSpec>): void;  // update one button
  };
  onAction(handler: (id: string) => void): void;  // bar clicks arrive here
  submit(content: string | {}): Promise<{}>;      // create the manifest(s)
  markDirty(dirty?: boolean): void;        // arms the unsaved-changes prompt
  close(): void;                           // back to the gallery
}

interface ButtonSpec {
  id: string;
  label: string;
  raised?: boolean;    // primary (filled) button
  disabled?: boolean;
}
```

Rules of the road:

- **The bar is the dashboard's.** Declare buttons with `ctx.buttons.set`;
  don't render your own submit buttons inside `host`. If you declare nothing
  you get Create/Cancel, with Cancel closing the card.
- **All writes go through `ctx.submit`.** It accepts a JSON/YAML string or a
  plain object (serialized for you) and resolves/rejects like the dashboard's
  own deploy-from-input. Deploy errors also surface in the dashboard's error
  dialog.
- **`ctx.http` is for reads** against the dashboard API (`api/v1/...`) — e.g.
  `api/v1/namespace`, `api/v1/crd`, `api/v1/_raw/...`. Same-origin,
  authenticated as the logged-in user.
- Call `ctx.markDirty(true)` once the user starts typing so navigation asks
  for confirmation; a successful `ctx.submit` clears it.
- Feature-detect additions (`if (ctx.buttons.patch) ...`); the ctx grows
  compatibly within `v1alpha1`.

## Native look for free

The host ships a stylesheet scoped to `.kd-form-plugin-host` that makes plain
HTML look like the rest of the dashboard. Treat these class names as stable
API:

- plain `label`, `input[type=text|number]`, `select`, `textarea`, `fieldset` +
  `legend` — pre-styled, no classes needed
- `.kdf-required` — the red asterisk inside a label
- `.kdf-hint` — small helper text under a field
- `.kdf-error` — error line (toggle `display` yourself)

## Authoring beyond hand-written scripts

For anything bigger than a few fields, don't write the final script by hand —
generate it. The pattern used by kazoo-operators:

```
dashboard-forms/
  src/ctx.d.ts               # this contract, as types
  src/my-form/form.ts        # export default function render(host, ctx) {...}
  build.sh                   # esbuild --bundle --format=iife  →  FormPlugin CR yaml
```

Bundle with any tool that emits a single IIFE, append
`__form.default(host, ctx);` (or equivalent), wrap it in the CR yaml, and
commit the generated manifest. TypeScript gives you a typed `ctx`; imports and
shared helpers work normally.

## Reference examples

- `aio/deploy/kind/demo-formplugin.yaml` — quick-namespace: the minimal
  end-to-end form (one field, two buttons, submit).
- kazoo-operators `config/dashboard/formplugin-kazoo-media.yaml` — a real
  product form (subforms, namespace select, optional fields).
- `src/app/frontend/create/from/form/stock/crdform.ts` — the stock Custom
  resource card: generates a whole form from a CRD's openAPI schema; the most
  complete exercise of the contract.
