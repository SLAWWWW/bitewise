# Temporary visual guide

Sign in, then open **Panduan visual / Visual guide** in the sidebar, or `/panduan`.
Six interactive diagrams cover the complete donation journey, allocation decisions,
warehouse operations, architecture, background work, and business data relationships.

Select a node to read its actor, inputs, action, output, blockers, and implementation
references. Related-screen links follow the current role's navigation permissions.
Sequence diagrams support manual stepping and optional six-second playback. On small
screens, arrows and details become a vertical reading flow. The architecture is a
relationship diagram, with explicit incoming/outgoing connections in each detail.
The guide and its examples never issue operational commands.

**Unduh dokumentasi / Download documentation** exports all six diagrams as Markdown
with Mermaid graphs and the same explanations. The download is created locally in
the browser; it contains documentation, not tenant records or credentials.

`content.ts` is the single documentation source for diagrams and export. It describes
the current P0 simulation, not future live integrations. Source references were
checked against the repository; update the content when changing a workflow.

## Hide before deployment

Set `PROTOTYPE_GUIDE_ENABLED=false` and restart the web process. The sidebar and
command-palette entry disappear and direct visits return a not-found page. The
server also rejects the guide whenever **either the app process or tenant is LIVE**,
even if the flag is true. Do not rely on a hidden navigation item as the route guard.

## Delete later

1. Delete `app/(ops)/panduan/`, `components/prototype-guide/`, and
   `src/config/prototype-guide.ts`.
2. Remove the guide import and `prototypeGuide` option in `app/(ops)/layout.tsx`.
   Remove the `prototypePage` walkthrough exception and its `usePathname` / `isActive`
   imports in `components/layout/AppShell.tsx`.
3. Remove the `/panduan` item, `prototypeOnly` property/filter, and `prototypeGuide`
   option from `src/ui/nav.ts`. Remove the guide-only Network icon from its type and
   `components/layout/icons.ts`.
4. Remove `nav.panduan` and `nav.hint.panduan` from both common dictionaries and
   `PROTOTYPE_GUIDE_ENABLED` from `.env.example` and deployment configuration.
5. Delete `tests/unit/security/prototype-guide.test.ts` and
   `tests/e2e/visual-guide.spec.ts`; restore the ordinary navigation test to compare
   all production items. Remove this feature's README section.

This feature adds no database tables, jobs, API commands, or operational state.
