---
title: Quick Start
slug: quick-start
id: quick-start
---

# Quick Start

Get your first Catalyst app running in under 5 minutes. This guide will have you building a universal React application with server-side rendering in no time.

---

## Prerequisites

Before you begin, make sure you have:

- **Node.js 20.4.0 or later** - [Download here](https://nodejs.org/)
- **npm** or **yarn** package manager
- A code editor (VS Code recommended)

---

## Step 1: Create Your App

Open your terminal and run:

```bash
npx create-catalyst-app@latest my-app
```

You'll be prompted with a few questions:

```bash
? Enter the name of your Catalyst application: my-app
? Enter a description: My first Catalyst app
? Enable TypeScript support? (Y/n) Y
? Include Tailwind CSS? (Y/n) n
? Add MCP support? (Y/n) n
? Choose a state management option: None
```

**Pro tip:** Hit Enter to accept the defaults for a minimal setup.

---

## Step 2: Start Development Server

Navigate to your new project and start the dev server:

```bash
cd my-app
npm run start
```

You should see:

```bash
Catalyst development server starting...
✓ Server running at http://localhost:3005
✓ Client bundle built successfully
```

---

## Step 3: View Your App

Open your browser and visit:

**[http://localhost:3005](http://localhost:3005)**

You'll see your Catalyst app running! 🎉

The page is **server-side rendered** - view the page source to see the HTML was generated on the server.

---

## Step 4: Make Your First Edit

Open `src/js/pages/Home/index.js` in your editor:

```javascript
export default function Home() {
  return (
    <div className="home-page">
      <h1>Welcome to Catalyst</h1>
      <p>Edit this file and save to see hot reload in action!</p>
    </div>
  );
}
```

Change the heading to something else:

```javascript
export default function Home() {
  return (
    <div className="home-page">
      <h1>My First Catalyst App</h1>
      <p>This is server-side rendered and ready for mobile!</p>
    </div>
  );
}
```

**Save the file** - your browser will automatically update! That's Hot Module Replacement (HMR) in action.

---

## Step 5: Add Data Fetching

Let's fetch some data on the server. Update your `Home/index.js`:

```javascript
// Fetch data on the server before rendering
export const serverFetcher = async () => {
  // This runs on the server during SSR
  const response = await fetch('https://jsonplaceholder.typicode.com/users/1');
  const user = await response.json();

  return { user };
};

// Component receives the fetched data
export default function Home({ data }) {
  return (
    <div className="home-page">
      <h1>Hello, {data.user.name}!</h1>
      <p>Email: {data.user.email}</p>
      <p>Company: {data.user.company.name}</p>
    </div>
  );
}
```

Refresh your browser - the data was fetched on the server and rendered in the HTML!

---

## Step 6: Add a New Route

Create a new page at `src/js/pages/About/index.js`:

```javascript
export default function About() {
  return (
    <div className="about-page">
      <h1>About</h1>
      <p>This is a universal React app built with Catalyst.</p>
      <ul>
        <li>Server-side rendering</li>
        <li>Hot module replacement</li>
        <li>Automatic code splitting</li>
        <li>Ready for iOS and Android</li>
      </ul>
    </div>
  );
}
```

Register your route in `src/js/routes/index.js`:

```javascript
import Home from '../pages/Home';
import About from '../pages/About';

const routes = [
  {
    path: '/',
    component: Home
  },
  {
    path: '/about',
    component: About
  }
];

export default routes;
```

Visit **[http://localhost:3005/about](http://localhost:3005/about)** - your new route works!

---

## Step 7: Add Navigation

Let's add links between pages. Create `src/js/components/Navigation.js`:

```javascript
import { Link } from 'react-router-dom';

export default function Navigation() {
  return (
    <nav style={{ padding: '1rem', background: '#f0f0f0' }}>
      <Link to="/" style={{ marginRight: '1rem' }}>Home</Link>
      <Link to="/about">About</Link>
    </nav>
  );
}
```

Add it to your pages:

```javascript
import Navigation from '../../components/Navigation';

export default function Home({ data }) {
  return (
    <>
      <Navigation />
      <div className="home-page">
        <h1>Hello, {data.user.name}!</h1>
        {/* ... rest of your content */}
      </div>
    </>
  );
}
```

Now you can navigate between pages with instant client-side routing!

---

## 🎉 Congratulations!

In just 5 minutes, you've:

- Created a Catalyst app
- Ran a development server
- Used server-side rendering
- Fetched data from an API
- Added routes and navigation
- Experienced hot module replacement

---

## What's Next?

### Build for Mobile (Optional - 10 minutes)

Want to see your app on iOS or Android?

```bash
# For Android
npm run buildApp:android

# For iOS (macOS only)
npm run buildApp:ios
```

Learn more in the [Universal Apps guide](/content/Guides%20and%20Tutorials/First%20Universal%20App/first-universal-app).

---

## Learn More

Now that you have the basics, explore these topics:

### Core Concepts
- **[Routing](/content/03-Routing/01-Defining-Routes.md)** - Nested routes, dynamic parameters, layouts
- **[Data Fetching](/content/data-fetching)** - Server and client fetchers, caching
- **[App Shell](/content/09-Core%20Concepts/01-App-Shell.md)** - Layout and app structure
- **[State Management](/content/09-Core%20Concepts/02-State-Management.md)** - Redux integration

### Building Features
- **[Styling](/content/05-Styling.md)** - CSS Modules, Sass, Tailwind
- **[Code Splitting](/content/07-Lazy%20Loading/01-Code-Splitting.md)** - Optimize bundle size
- **[Middleware](/content/Guides%20and%20Tutorials/adding-express-middlewares)** - Add authentication, logging
- **[Assets](/content/14-Best%20Practices/05-Assets.md)** - Images and static files

### Universal Apps
- **[First Universal App](/content/Guides%20and%20Tutorials/First%20Universal%20App/first-universal-app)** - Complete walkthrough
- **[Hooks](/content/API%20Reference/hooks)** - Camera, storage, haptics
- **[Android Setup](/content/Guides%20and%20Tutorials/android-emulator-setup)** - Configure Android development
- **[iOS Setup](/content/Guides%20and%20Tutorials/ios-emulator-setup)** - Configure iOS development

### Tutorials
- **[Pet Adoption App](/content/Guides%20and%20Tutorials/Building%20Pet%20Adoption%20App/pet-adoption-introduction)** - Build a full-featured app step-by-step

---

## Project Structure

Your Catalyst app has this structure:

```
my-app/
├── config/
│   └── config.json        # App configuration
├── src/
│   ├── js/
│   │   ├── pages/         # Page components
│   │   ├── components/    # Shared components
│   │   └── routes/        # Route definitions
│   └── static/            # CSS, images, fonts
├── server/
│   ├── document.js        # HTML template
│   └── server.js          # Express server
├── client/
│   └── index.js           # Client entry point
└── package.json
```

Learn more in [Project Structure](/content/Guides%20and%20Tutorials/First%20Catalyst%20App/folder-structure).

---

## Common Commands

```bash
# Development
npm run start              # Start dev server
npm run start:prod         # Start production server

# Building
npm run build              # Build for production
npm run analyze            # Analyze bundle size

# Universal Apps
npm run buildApp:android   # Build Android app
npm run buildApp:ios       # Build iOS app (macOS only)
npm run installApp:android # Install on Android device
```

See all commands in [CLI Reference](/content/cli-reference).

---

## Need Help?

- 📖 **[Full Documentation](/)** - Comprehensive guides
- 💬 **[Discord](https://discord.gg/GTzYzP8X6s)** - Chat with the community
- 🐛 **[GitHub Issues](https://github.com/tata1mg/catalyst-core/issues)** - Report bugs
- **[Discussions](https://github.com/tata1mg/catalyst-core/discussions)** - Ask questions

---

## Tips for Success

### 1. Use TypeScript
Get better autocomplete and catch errors early:
```bash
npx create-catalyst-app@latest my-app --typescript
```

### 2. Leverage Server Fetchers
Fetch data on the server for better performance and SEO:
```javascript
export const serverFetcher = async () => {
  const data = await fetchData();
  return { data };
};
```

### 3. Keep Components Small
Break down large components for better code splitting:
```javascript
import { lazy } from 'react';

const HeavyComponent = lazy(() => import('./HeavyComponent'));
```

### 4. Use the Cache
Cache expensive operations:
```javascript
import { Cache } from 'catalyst-core/universal';

const data = await Cache.get('key') || await fetchData();
await Cache.set('key', data);
```

---

You are now ready to build production-ready universal applications.

Continue with the [Installation Guide](/content/Guides%20and%20Tutorials/First%20Catalyst%20App/installation) for more detailed setup options, or jump into [Core Concepts](/content/03-Routing/01-Defining-Routes.md) to learn how Catalyst works under the hood.
