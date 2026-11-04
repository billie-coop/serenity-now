# Publishing: decisions and steps

How serenity-now is published, and the record of its move to the `@billie-coop` npm scope.
Update this file as things are decided or done.

## Decided

- **The npm package is `@billie-coop/serenity-now`** (decided by Stephen 2026-11-03, same as
  `@billie-coop/hereabouts` and `@billie-coop/seaq`). Versions up to 0.3.1 were published as
  the unscoped `serenity-now`, owned by Stephen's personal npm account. That name is
  deprecated with a pointer, not unpublished.
- **The command stays `serenity-now`.** `bin` is a string, so npm names the command after
  the package without its scope; with one bin entry, `npx @billie-coop/serenity-now` runs it.
  (A `{ "serenity-now": ... }` map doesn't stick: `yarn install` rewrites it back to the
  string.) The release workflow checks this by running `serenity-now --help` from the packed
  tarball.
- **Docs say `npx @billie-coop/serenity-now`** wherever they mean fetching from npm, and
  `serenity-now` where they mean the installed command (package.json scripts, `--help`).
  A bare `npx serenity-now` would fetch the deprecated package, so the docs never say it.
  `DOCS.npmPackage` in `src/docs/content.ts` holds the name for the CLI help and the site; a
  test keeps it equal to package.json's `name`.
- **The first version under the new name is 0.4.0.**
- **Releases go through `.github/workflows/release.yml`** (renamed from `publish.yml`), with
  npm trusted publishing (OIDC, no token). It is modelled on hereabouts' `release.yml`:
  manual only, dry run by default, must run from `main`, refuses a version whose `v<version>`
  tag or npm version already exists, then checks, tests, builds, runs the packed CLI, and
  publishes with provenance and a GitHub release. Bump `package.json` on `main` first.
  - It gets Node and yarn the way this repo's CI does (`setup-node` with Node 24, then
    corepack), not with proto as hereabouts does: the CI and docs workflows already work that
    way, and `.prototools` here also lists unpinned bun and deno.
  - It no longer bumps the version, keeps a `release` branch, or needs the `ADMIN_TOKEN`
    secret. The `release` branch on origin is left as it was.
  - devDependencies stay in the published manifest: they're plain semver ranges (no
    `workspace:`), and npm ignores them on install.
- **`prepublishOnly` is removed.** It ran `biome check --write`, which could change files
  between the commit and the tarball; the release workflow runs the checks itself.
- **All workflows use actions that run on Node 24** (`checkout@v6`, `setup-node@v6`,
  `configure-pages@v6`, `upload-pages-artifact@v5`, `deploy-pages@v5`). GitHub deprecates
  Node 20 actions.
- **Docs deploy to GitHub Pages** at `https://billie-coop.github.io/serenity-now/`, unchanged.

## Moving to `@billie-coop/serenity-now` (2026-11-03)

npm only lets a package's trusted publisher be set once the package exists, so the name was
claimed with a prerelease published by hand, and 0.4.0 went through the workflow. All done
2026-11-03 except step 6.

1. Done: renamed on `main` (`11bfcec`): package.json `name`, version 0.4.0, the README, the
   site, the CLI help and the release workflow. CI and the docs deploy passed, and the live
   site says `npx @billie-coop/serenity-now`.
2. Done: claimed the name from Stephen's machine with npm 11, after `yarn build`:
   `npm pkg set version=0.4.0-rc.0`, `npm publish --access public --tag next` (browser 2FA),
   then `git checkout package.json`. npm also created its `0.0.0-stage` placeholder, and
   tagged the rc `latest` until 0.4.0 replaced it.
3. Done: trusted publisher, with browser 2FA:
   `npm trust github @billie-coop/serenity-now --file release.yml --repo billie-coop/serenity-now --allow-publish`.
   npm gave it "publish, stage publish".
4. Done: Release workflow dry run
   ([41762598777](https://github.com/billie-coop/serenity-now/actions/runs/41762598777)), then
   the real run ([41762674680](https://github.com/billie-coop/serenity-now/actions/runs/41762674680)):
   0.4.0 is `latest` with a SLSA v1 provenance attestation, and the GitHub release
   [v0.4.0](https://github.com/billie-coop/serenity-now/releases/tag/v0.4.0) exists. That
   publish also validated the trusted publisher. `npx @billie-coop/serenity-now --help` and a
   `--dry-run` on a copy of `example/` work from a clean directory.
   - npm warns that it "auto-corrected" `bin` while publishing (string to object, and "script
     name dist/cli.js was invalid and removed"). The published manifest is fine:
     `"bin": { "serenity-now": "dist/cli.js" }`, as in 0.3.1.
5. Done: deprecated `@billie-coop/serenity-now@0.0.0-stage` ("npm staging placeholder; use
   0.4.0 or later") and every bare `serenity-now` version, 0.1.1 to 0.3.1 ("Moved to
   @billie-coop/serenity-now: npm install @billie-coop/serenity-now"). Nothing is unpublished.
6. **Open:** Stephen sets "Require two-factor authentication and disallow tokens" on
   `https://www.npmjs.com/package/@billie-coop/serenity-now/access`.

Left as they were: the `next` dist-tag still points to `0.4.0-rc.0`; the old `release`
branch on origin; the `ADMIN_TOKEN` repo secret, which no workflow uses now.

## Repos that use the bare name

These keep working (deprecating removes nothing) but need switching to
`@billie-coop/serenity-now` to get new versions: `billie-coop-monorepo` (and its -2/-3/-4
clones), `billie-tracker-tools`, `billie-coop-test`.
