# Migrating from Next.js to Catalyst

## Step 1: Project Setup

Create a new Catalyst project:

```bash
npx create-catalyst-app@latest
```

> Perform the entire migration in a new folder to avoid dependency conflicts between Next.js and Catalyst.

## Step 2: Project Structure

1. Understand the differences in project structure:

   **Next.js:**
   ```text
   pages/
   public/
   styles/
   ```

   **Catalyst:**
   ```text
   config/      # Configuration keys
   src/         # Application source code
     components/
     routes/
     services/
     utils/
   client/      # Client app entry point
   server/      # API and middleware
   build/       # Bundled code
   ```

   > For detailed information about Catalyst's folder structure, see: [Folder Structure Guide](/content/Guides%20and%20Tutorials/First%20Catalyst%20App/folder-structure)

2. Move your existing components from various locations to `src/components/`.

3. Relocate any utility functions to `src/utils/`.

## Step 3: [Routing](/content/03-Routing/01-Defining-Routes.md)
1. Replace Next.js file-based routing with Catalyst's route configuration.

2. Open src/routes/index.ts.

3. Define your routes using the ```react-router-v6 ``` style:
    ```javascript
    const routes = [
    {
        path: "/",
        index: true,
        component: HomePage,
    },
    {
        path: "/cart",
        component: CartComponent,
        children: [
        {
            path: "",
            component: CartChild
        },
        {
            path: "prescription",
            component: Prescription
        }
        ],
    },
    {
        path: "/health-products",
        component: HealthProducts,
    },
    ]
    ```
4. Update dynamic routes to use react-router-v6 syntax:
   - `[id].js` → `path: "/products/:id"`
   - `[...slug].js` → `path: "/products/*"`

## Step 4: Migration of Folder Structure
1. Move your page components from `pages/` to act as route components in the routes definition.

2. Ensure all other components are in `src/components/`.

3. Move your API routes from `pages/api/` to the `server/` directory in Catalyst.

## Step 5: Next.js App Router to Catalyst Migration

If you're migrating from Next.js App Router (with React Server Components), here's how to adapt your components:

### Key Differences:

**Next.js RSC:**
- Components can be async and fetch data directly
- Server Components render on the server only
- Client Components require 'use client' directive

**Catalyst Framework:**
- Traditional React components with separate data fetchers
- `serverFetcher`: Runs during SSR, server-only code
- `clientFetcher`: Runs during client-side navigation
- Data accessed via `useCurrentRouteData` hook

### Migration Example: Basic Data Fetching

**Next.js RSC Implementation:**
```javascript
// app/products/page.tsx
async function ProductsPage() {
  const products = await fetch('https://api.example.com/products').then(r => r.json());
  
  return (
    <div>
      <h1>Products</h1>
      {products.map(product => (
        <div key={product.id}>{product.name}</div>
      ))}
    </div>
  );
}

export default ProductsPage;
```

**Catalyst Implementation:**
```javascript
// pages/Products.jsx
import { useCurrentRouteData } from "@tata1mg/router";

const ProductsPage = () => {
  const { data: products, isFetching, error } = useCurrentRouteData();
  
  if (isFetching) return <div>Loading...</div>;
  if (error) return <div>Error loading products</div>;
  
  return (
    <div>
      <h1>Products</h1>
      {products?.map(product => (
        <div key={product.id}>{product.name}</div>
      ))}
    </div>
  );
};

// Client-side navigation
ProductsPage.clientFetcher = async () => {
  const res = await fetch('https://api.example.com/products');
  const products = await res.json();
  return products;
};

// Server-side rendering
ProductsPage.serverFetcher = async () => {
  const res = await fetch('https://api.example.com/products');
  const products = await res.json();
  return products;
};

export default ProductsPage;
```

### Key Migration Steps:

1. **Convert async components** to regular React components
2. **Move data fetching logic** from component body to separate `serverFetcher`/`clientFetcher` functions
3. **Add loading and error handling** in the component using `useCurrentRouteData`
4. **Remove 'use client' directives** - not needed in Catalyst

## Step 6: [Data Fetching](/content/data-fetching)

### Key Migration Steps:

1. **Replace Next.js data fetching methods** (```getServerSideProps, getStaticProps```) with Catalyst's data fetching methods:
   - ```getServerSideProps``` → ```ComponentName.serverFetcher```
   - ```getStaticProps``` → ```ComponentName.serverFetcher``` (with caching logic if needed)

2. **Update components to use the useCurrentRouteData hook**:
   ```javascript
   const { isFetching, isFetched, error, data, refetch, clear } = useCurrentRouteData()
   ```

### Migration Example

**Next.js Implementation:**
```javascript
// pages/user/[id].js
export default function UserProfile({ user }) {
  return <div>{user.name}</div>
}

export const getServerSideProps = async (context) => {
  const { id } = context.params
  const res = await fetch(`https://api.example.com/users/${id}`)
  const user = await res.json()
  
  return { props: { user } }
}
```

**Catalyst Implementation:**
```javascript
// src/components/UserProfile.js
import { useCurrentRouteData } from '@tata1mg/router'

const UserProfile = () => {
  const { data } = useCurrentRouteData()
  return <div>{data?.name}</div>
}

UserProfile.serverFetcher = async ({ params }) => {
  const { id } = params
  const res = await fetch(`https://api.example.com/users/${id}`)
  return await res.json()
}

UserProfile.clientFetcher = async ({ params }) => {
  const { id } = params  
  const res = await fetch(`https://api.example.com/users/${id}`)
  return await res.json()
}

export default UserProfile
```

## Step 7: Middlewares
1. In Next.js, you used middleware.ts (or .js) in the project root.
2. Catalyst offers a flexible approach to defining server-side code, granting you greater control and customization over server operations.

```javascript
// server/index.js
export function addMiddlewares(app) {
    app.use()
}
```


## Step 8: [State Management](/content/09-Core%20Concepts/02-State-Management.md)

### Migration Example: Redux Store Setup

**Next.js Implementation:**
```javascript
// store/store.js
import { createStore } from 'redux'
import rootReducer from './reducers'

const store = createStore(rootReducer)
export default store

// pages/_app.js
import { Provider } from 'react-redux'
import store from '../store/store'

export default function App({ Component, pageProps }) {
  return (
    <Provider store={store}>
      <Component {...pageProps} />
    </Provider>
  )
}
```

**Catalyst Implementation:** 

When you create a new Catalyst application using `create-catalyst-app`, the following Redux setup comes pre-configured:

- **Store configuration** at `src/js/store/index.js` with proper initialization
- **Redux Provider wrapper** automatically handled by the framework - no need to manually wrap your app
- **Server-side store integration** with access to the store during SSR via fetchers
- **Initial state hydration** from server to client automatically managed
```javascript
// src/js/store/index.js
import { createStore } from 'redux'
import homeReducer from '@reducers/homeReducer.js'

export default function configureStore(initialState, request) {
  // request object available when store is initialized on server
  const store = createStore(homeReducer, initialState)
  return store
}
```

### Key Migration Steps:

1. **Move Redux store setup** from your custom location to ```src/js/store/index.js```
2. **Remove Provider wrapper** from your app component - Catalyst handles this automatically
3. **Access store in fetchers** using the ```store``` parameter:
   ```javascript
   HomePage.serverFetcher = async ({ req }, { store }) => {
     return store.dispatch(getHomePageData())
   }
   ```

4. **If using other state management solutions**: Implement at the root of your Catalyst application and update components accordingly.
## Step 9: [Styling](/content/05-Styling.md)

### Migration Example: CSS Modules

**Next.js Implementation:**
```javascript
// styles/Home.module.css
.container { padding: 2rem; }

// pages/index.js
import styles from '../styles/Home.module.css'
export default function Home() {
  return <div className={styles.container}>Home</div>
}
```

**Catalyst Implementation:**
```javascript
// src/components/Home/Home.module.css
.container { padding: 2rem; }

// src/components/Home/Home.js
import styles from './Home.module.css'
export default function Home() {
  return <div className={styles.container}>Home</div>
}
```

### Key Migration Steps:

1. **Move CSS files** to component directories or appropriate locations in the new structure
2. **Global styles**: Place in `/src/static/css/base` and import in `client/styles.js`
3. **CSS Modules work out-of-the-box** - no configuration needed
4. **SCSS support** is included - just use `.scss` file extensions

> For detailed styling options and examples, see: [Styling Documentation](/content/05-Styling.md)

## Step 10: Image Handling
1. Replace ```next/image``` usage with standard ```<img>``` tags or create a custom image component.


## Step 11: [Font Optimization](/content/06-Fonts.md)

### Migration Example: Next.js Font to Manual Implementation

**Next.js Implementation:**
```javascript
import { Inter, Roboto_Mono } from 'next/font/google'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
})

const robotoMono = Roboto_Mono({
  subsets: ['latin'],
  display: 'swap',
})

export default function MyApp({ Component, pageProps }) {
  return (
    <main className={inter.className}>
      <h1 className={robotoMono.className}>Hello World</h1>
      <Component {...pageProps} />
    </main>
  )
}
```

**Catalyst Implementation Options:**

**Option 1: Manual CSS Font Loading**
```css
/* src/static/css/base/fonts.css */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto+Mono:wght@400;500&display=swap');

:root {
  --font-inter: 'Inter', sans-serif;
  --font-roboto-mono: 'Roboto Mono', monospace;
}

body {
  font-family: var(--font-inter);
}

.font-mono {
  font-family: var(--font-roboto-mono);
}
```

**Option 2: React Helmet for Dynamic Font Management**

First install React Helmet: `npm install react-helmet`

```javascript
import { Helmet } from 'react-helmet'

const Component = ({ children }) => {
  return (
    <>
      <Helmet>
        <link 
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto+Mono:wght@400;500&display=swap" 
          rel="stylesheet"
        />
        <link 
          rel="preload" 
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" 
          as="style" 
        />
      </Helmet>
      {children}
    </>
  )
}
```

- **React Helmet**: [react-helmet](https://www.npmjs.com/package/react-helmet) - Dynamic head management

## Step 12: Script Management

### Migration Example: Next.js Script to Manual Implementation

**Next.js Implementation:**
```javascript
import Script from 'next/script'

export default function MyApp({ Component, pageProps }) {
  return (
    <>
      <Script
        src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'GA_MEASUREMENT_ID');
        `}
      </Script>
      <Component {...pageProps} />
    </>
  )
}
```

**React Helmet for Dynamic Script Management**

Install React Helmet: `npm install react-helmet`

```javascript
// src/components/Analytics/Analytics.js
import { Helmet } from 'react-helmet'

const Analytics = ({ measurementId }) => {
  return (
    <Helmet>
      {/* External script with preloading */}
      <link 
        rel="preload" 
        href={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        as="script"
      />
      <script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
      />
      
      {/* Inline script */}
      <script>
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${measurementId}');
        `}
      </script>
    </Helmet>
  )
}
```

- **React Helmet**: [react-helmet](https://www.npmjs.com/package/react-helmet) - Dynamic head management with script support
- **React Helmet Async**: [react-helmet-async](https://www.npmjs.com/package/react-helmet-async) - SSR-safe version with better performance

## Step 13: Layouts

### Migration Example: Global Layout

**Next.js Implementation:**
```javascript
// components/layout.js
import Header from './Header'
import Footer from './footer'
 
export default function Layout({ children }) {
  return (
    <>
      <Header />
      <main>{children}</main>
      <Footer />
    </>
  )
}
```

**Catalyst Implementation:**
```javascript
// src/js/containers/App/index.js
import React from "react"
import { Outlet } from "@tata1mg/router"

import Header from './Header'
import Footer from './footer'

const App = () => {
    return (
        <div>
            <Header />
            <main>
                <Outlet />
            </main>
            <Footer />
        </div>
    )
}
```

> For layout examples, see: [Pet Adoption App Layout Guide](/content/Guides%20and%20Tutorials/Building%20Pet%20Adoption%20App/layout-setup)

## Step 14: [Metadata and Head Management](/content/14-Best%20Practices/01-Dynamic-Metadata.md)

### Migration Example: Dynamic Metadata

**Next.js Implementation:**
```javascript
// pages/user/[id].js
import Head from 'next/head'

export default function UserProfile({ user }) {
  return (
    <>
      <Head>
        <title>Profile</title>
      </Head>
      <div>User Profile</div>
    </>
  )
}
```

**Catalyst Implementation:**
```javascript
// src/components/UserProfile/UserProfile.js
const UserProfile = () => {
  return <div>User Profile</div>
}

UserProfile.setMetaData = () => {
  return [
    <title key="title">Profile</title>,
  ]
}
```

> For detailed metadata management, see: [Dynamic Metadata Documentation](/content/14-Best%20Practices/01-Dynamic-Metadata.md)

## Step 15: [Environment Variables](/content/Guides%20and%20Tutorials/First%20Catalyst%20App/environment-variables)

### Migration Example: Environment Configuration

**Next.js Implementation:**
```javascript
// .env.local
NEXT_PUBLIC_API_URL=https://api.example.com
DATABASE_URL=postgresql://localhost:5432/mydb

// Usage in code
const apiUrl = process.env.NEXT_PUBLIC_API_URL
const dbUrl = process.env.DATABASE_URL
```

**Catalyst Implementation:**
```json
// config/config.json
{
  "API_URL": "https://api.example.com",
  "DATABASE_URL": "postgresql://localhost:5432/mydb",
  "CLIENT_ENV_VARIABLES": ["API_URL"]
}
```

```javascript
// Usage in code
const apiUrl = process.env.API_URL        // Available on both client & server
const dbUrl = process.env.DATABASE_URL    // Server-only (not in CLIENT_ENV_VARIABLES)
```

### Key Migration Steps:

1. **Move environment variables** from `.env` files to `config/config.json`
2. **Remove `NEXT_PUBLIC_` prefixes** - use `CLIENT_ENV_VARIABLES` instead
3. **List client-accessible variables** in the `CLIENT_ENV_VARIABLES` array
4. **Server-only variables** should NOT be included in `CLIENT_ENV_VARIABLES`

**Security note:** Variables listed in `CLIENT_ENV_VARIABLES` are exposed to the client and can be viewed in browser dev tools.

> For the complete environment configuration guide, see: [Environment Variables Documentation](/content/Guides%20and%20Tutorials/First%20Catalyst%20App/environment-variables)


## Step 16: Build and Deployment
1. Update your build script from next build to Catalyst's build process: ```npm run build```.

2. Modify your deployment scripts and configurations to work with the new Catalyst build output.

## Step 17: Final Checks
1. Update all import statements to reflect the new project structure.

2. Replace any remaining Next.js specific components or functions with their Catalyst equivalents or standard React/HTML alternatives.

3. Test your application thoroughly to ensure all features work as expected in the new Catalyst environment.

## Resources

- [Catalyst Documentation](/content/Guides%20and%20Tutorials/First%20Catalyst%20App/installation)
- [Next.js documentation](https://nextjs.org/docs/getting-started/installation)
- [Catalyst Middleware](/content/Guides%20and%20Tutorials/adding-express-middlewares)
- [Next js Middleware ](https://nextjs.org/docs/app/building-your-application/routing/middleware)
- [Catalyst Routing](/content/03-Routing/01-Defining-Routes.md)
- [Next.js routing](https://nextjs.org/docs/app/building-your-application/routing)
