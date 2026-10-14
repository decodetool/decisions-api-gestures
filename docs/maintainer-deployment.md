# Maintainer deployment

[Open the private live demo](https://openai-decisions-magic-pen.vercel.app/).

The Vercel project `francoislaberges-projects/openai-decisions-magic-pen` has Vercel Authentication enabled for **all deployments**, including the stable domain. Sign in with the Vercel account that owns the project. Unauthenticated requests to both the canvas and `/api` redirect to login. Do not disable protection or distribute automation bypass credentials.

`vercel.json` builds the frontend with `npm run build:private`: `NODE_ENV=development vite build --mode development`. This is an actual development frontend bundle, even when Vercel labels the deployment “Production.” The normal `npm run build` command still produces a production frontend. The deployed API remains a Node function: `api/index.js` exports the existing Express app, and `/api/:path*` rewrites to that function. It does not start the local Vite server.

`OPENAI_API_KEY` is stored as a Vercel **Secret** for Preview and Production, read only by the server-side API. `.env`, `.env.*`, local Vercel state, and results are excluded from uploads / Git as appropriate. Never use a `VITE_` prefix for the OpenAI key. Changes to cloud environment variables require a new deployment.

To deploy from a fresh checkout or another machine:

1. Open a terminal in `decisions-api-gestures` and install dependencies with `npm ci`.
2. Sign in to the existing Vercel account, then link this directory to the existing project. `.vercel/` is not committed, so each new checkout needs linking:

```sh
npx --yes vercel@latest login
npx --yes vercel@latest link --yes --project openai-decisions-magic-pen --scope francoislaberges-projects
```

3. Confirm the cloud key is present. It is already configured as a Secret for both Preview and Production; listing variables shows metadata, not its value:

```sh
npx --yes vercel@latest env ls --scope francoislaberges-projects
```

If the key is missing, add it using the CLI's masked input prompt (paste the key only into that prompt):

```sh
npx --yes vercel@latest env add OPENAI_API_KEY production,preview --type secret --scope francoislaberges-projects
```

The local `.env` is never uploaded; the deployed API uses Vercel's configured Secret.

4. Check the app and deploy to the stable URL:

```sh
npm test
npm run build:private
npx --yes vercel@latest deploy --prod --yes --scope francoislaberges-projects
```

Vercel runs `build:private` again in the cloud using `vercel.json`. `--prod` updates the stable Vercel URL; it does not change the frontend's development build mode. Every deployment remains behind Vercel Authentication with the project's current **All Deployments** protection setting.

For later redeployments from an already-linked checkout, just run the final `deploy` command. Environment-variable changes also need a redeployment before they take effect.

For an authenticated health check using the CLI:

```sh
npx --yes vercel@latest curl /api/health --deployment https://openai-decisions-magic-pen.vercel.app --scope francoislaberges-projects
```

Vercel's CLI uses a private automation bypass for this request; the public deployment continues to require login. Keep `.vercel/` ignored because it can hold local project / automation credentials.
