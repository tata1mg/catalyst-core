---
title: Layout Setup
slug: layout-setup
id: layout-setup
sidebar_position: 7
---

# Layout Setup

Create a shared layout with header and footer that wraps all pages.

---

## Create the Layout Component

Create `src/js/layouts/MainLayout/MainLayout.js`:

```jsx title="src/js/layouts/MainLayout/MainLayout.js"
import React from "react";
import { Outlet } from "@tata1mg/router";
import loadable from "@loadable/component";
import Header from "../../components/Header/Header";

// Lazy load the Footer component
const Footer = loadable(() => import("../../components/Footer/Footer"), {
  fallback: <div>Loading footer...</div>,
  ssr: false,
});

const MainLayout = () => {
  return (
    <div>
      <Header />
      <main>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
};

export default MainLayout;
```

The `<Outlet />` component renders the matched child route.

---

## Create the Header Component

Create `src/js/components/Header/Header.js`:

```jsx title="src/js/components/Header/Header.js"
import React from "react";
import { Link } from "@tata1mg/router";

const Header = () => {
  return (
    <header className="header">
      <div className="header-brand">
        <img src="/assets/dog-logo.png" alt="Logo" className="header-logo" />
        <h1>Dog Adoption Center</h1>
      </div>
      <nav>
        <Link to="/" className="nav-link">Home</Link>
        <Link to="/about" className="nav-link">About</Link>
      </nav>
    </header>
  );
};

export default Header;
```

---

## Create the Footer Component

Create `src/js/components/Footer/Footer.js`:

```jsx title="src/js/components/Footer/Footer.js"
import React from "react";

const Footer = () => {
  return (
    <footer className="footer">
      <p>© 2026 Dog Adoption Center</p>
      <p>
        Data from <a href="https://dog.ceo/dog-api/">Dog API</a>
      </p>
    </footer>
  );
};

export default Footer;
```

---

## Create an About Page

Create `src/js/pages/About/About.js`:

```jsx title="src/js/pages/About/About.js"
import React from "react";

const About = () => {
  return (
    <div className="container">
      <h1>About</h1>
      <p>A demo application built with Catalyst.</p>
    </div>
  );
};

export default About;
```

---

## Update Routes

Update `src/js/routes/index.js` to use the layout:

```jsx title="src/js/routes/index.js"
import MainLayout from "../layouts/MainLayout/MainLayout";
import Home from "../pages/Home/Home";
import BreedDetails from "../pages/BreedDetails/BreedDetails";
import About from "../pages/About/About";

const routes = [
  {
    path: "/",
    component: MainLayout,
    children: [
      {
        path: "",
        index: true,
        component: Home,
      },
      {
        path: "breed/:breed",
        component: BreedDetails,
      },
      {
        path: "about",
        component: About,
      },
    ],
  },
];

export default routes;
```

All pages now share the header and footer. Next, we'll set up static asset loading.
