# Creating a Catalyst App

Scaffold your Catalyst app swiftly with `create-catalyst-app`. This tool expedites the process by initializing your project with predefined configurations. To kickstart your project, execute the following command:

```bash
npx create-catalyst-app@latest
```

Upon execution, you'll be prompted to name your project. Once named, a template will be cloned into the specified directory.

```bash
✔ What is your project named? my-app
```

Next, select your preferred state management tool from the provided options.

```bash
? Choose state management: › - Use arrow-keys. Return to submit .
❯   Redux
    Redux Toolkit (RTK)
    None
```

Following your selection, a default template will be cloned into the directory, and all necessary packages will be installed.

## Native apps

The last question, "Native platforms", sets the app up for Android, iOS or both. You then give an app id, which becomes the Android package name and the iOS bundle id. The app gets the native entries in `config/config.json` (including a `release` block whose placeholder host you replace with your production host), a placeholder `public/icon.png`, `credentials/` in `.gitignore`, and `.github/workflows/catalyst-native.yml` for release builds in GitHub Actions.

Without prompts:

```bash
npx create-catalyst-app@latest my-app --yes --native both --app-id com.yourcompany.myapp
```

`--native` takes `none`, `android`, `ios` or `both`. `--yes` alone creates a web-only app.

## Getting Started

Commence development by initiating the application in development mode with the following commands:

Navigate into the directory

```bash
cd my-app
```

For running the application in development mode, run:

```bash
npm run start
```

For a production build, change NODE_ENV to "production" in config/config.json, and then run :

```bash
npm run build
```

To serve the production build, execute:

```bash
npm run serve
```

## Documentation

Explore the complete documentation at [https://catalyst.1mg.com](https://catalyst.1mg.com).
