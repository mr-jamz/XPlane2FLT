# Deploy the corrected v9 from a separate GitHub branch

Recommended branch name: `preview-v9-obj8-render`

## GitHub website method

1. Create the `preview-v9-obj8-render` branch from your current working branch.
2. Open that new branch and upload every file and folder from this release.
3. Make sure the hidden `.github/workflows/deploy-pages.yml` file is included.
4. Commit the files to `preview-v9-obj8-render`.
5. In **Settings → Pages**, keep **Source** set to **GitHub Actions**.
6. Open **Actions → Deploy XPlane2FLT to GitHub Pages** and watch the run for
   `preview-v9-obj8-render`.

The included workflow tests and builds the project before publishing `dist`.
Pushing the release branch will deploy that branch to the repository's normal
GitHub Pages URL. GitHub Pages has one active deployment per repository, so this
test branch temporarily becomes the live Pages version until another configured
branch is deployed.

If an earlier v9 commit is already on this branch, replace its files with this
corrected package and commit again. The workflow will redeploy the rebuilt v9.

## Git command method

```bash
git switch -c preview-v9-obj8-render
git add --all
git commit -m "Add selected OBJ8 3D preview"
git push -u origin preview-v9-obj8-render
```

## Roll back to the current main build

Run the same Pages workflow from `main`, or push a new commit to `main`. The
workflow remains configured for both branches.

## Local verification

```bash
npm ci
npm test
npm run build
```

The production output is created in `dist/`. The application remains fully
static and does not require environment variables, API keys, or a server.
