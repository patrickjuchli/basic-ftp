# Releasing

Releases are built on GitHub Actions and staged on npm. A staged version is only published after it has been reviewed and approved with 2FA. Do the review and approval on a trusted device, such as your phone, not on the machine that pushed the tag.

## 1. Prepare (local machine)

1. Add a `## x.y.z` entry to CHANGELOG.md.
2. Bump the version: `npm version x.y.z --no-git-tag-version`
3. Commit both and push to master.
4. Wait for the Node.js CI and Integration Tests runs for that commit to pass.
5. Tag and push: `git tag vx.y.z && git push origin vx.y.z`

Never run `npm publish` or `npm stage publish` locally, and stay logged out of npm on this machine (`npm logout`). A version without provenance is not ours.

## 2. Stage (GitHub Actions)

The [Stage release](.github/workflows/publish.yml) workflow runs on the tag. It:

- checks that the tag matches package.json, the commit is on master and the changelog has an entry
- runs lint, build and unit tests
- stages the version on npm with `npm stage publish`
- creates a draft GitHub release with the changelog entry

## 3. Review (trusted device)

1. Open the workflow run in the Actions tab. Note the commit SHA in the run's header and check that the "Run npm stage publish" step succeeded.
2. Check that the Node.js CI and Integration Tests runs on master passed for that SHA.
3. Check the compare link in the run summary. It must start with the previous release tag and end with the SHA from the header. Don't rely on the summary alone, since the workflow itself writes it. Alternatively, type the link yourself: `https://github.com/patrickjuchli/basic-ftp/compare/v<previous>...<sha>`
4. Open the compare link and review every changed file, not just `src/`. Expand collapsed diffs.
   - **Code that runs during the build**: test files, `eslint.config.mjs` and `tsconfig.json`. Tests run after the build and could change `dist/` before it's staged.
   - **package-lock.json**: every version change is one you made, and every `resolved` URL points to `https://registry.npmjs.org/`.
   - **.github/**: no unexpected changes to workflows or scripts.
   - **package.json**: no new scripts, dependencies or changes to `files`.
   - **Commits**: no commits you don't recognize.
5. On npmjs.com under "Staged Packages" in the user menu at the top right, the version must match the tag and be the only staged entry.
6. Optional: `npm stage download <stage-id>` to inspect the staged tarball.

If anything is unexpected, reject all staged versions on npm and investigate before doing anything else.

## 4. Publish (trusted device)

1. Approve the staged version under "Staged Packages", with 2FA.
2. Check that the version's page on npmjs.com shows provenance with the commit SHA you reviewed.
3. Publish the draft release on GitHub.

## If something fails

- **Checks or tests failed**: nothing was staged. Fix it, move the tag and push again: `git tag -f vx.y.z && git push -f origin vx.y.z`
- **Staged, but the draft release failed**: re-run the failed job in the Actions tab.
- **Staged, but must not be published**: reject it on npm and release the fix as the next version.
