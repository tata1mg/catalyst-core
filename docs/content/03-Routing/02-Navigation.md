---
title: Navigation
slug: navigation
id: navigation
sidebar_position: 2
---

# Navigation

Catalyst uses [React Router v6](https://reactrouter.com/en/main) for navigation. You can navigate using the `Link` component, `useNavigate` hook, or within fetcher functions.

---

## Link Component

Use `Link` for declarative navigation:

```jsx
import { Link } from "@tata1mg/router";

function Navigation() {
  return (
    <nav>
      <Link to="/">Home</Link>
      <Link to="/about">About</Link>
      <Link to="/user/123">User Profile</Link>
    </nav>
  );
}
```

---

## useNavigate Hook

Use `useNavigate` for programmatic navigation:

```jsx
import { useNavigate } from "@tata1mg/router";

function LoginButton() {
  const navigate = useNavigate();

  const handleLogin = async () => {
    await performLogin();
    navigate("/dashboard");
  };

  return <button onClick={handleLogin}>Login</button>;
}
```

### With State

```jsx
navigate("/product/detail", {
  state: { fromPage: "product-list" }
});
```

### Replace History

```jsx
navigate("/login", { replace: true });
```

---

## Navigation in Fetchers

Both `clientFetcher` and `serverFetcher` receive a `navigate` function for redirects:

### Client Fetcher

```javascript
Home.clientFetcher = async ({ navigate }) => {
  const isAuthenticated = await checkAuth();

  if (!isAuthenticated) {
    navigate("/login");
    return;
  }

  return fetchData();
};
```

### Server Fetcher

On the server, `navigate` triggers an HTTP redirect:

```javascript
Home.serverFetcher = async ({ navigate }) => {
  const isAuthenticated = await checkServerAuth();

  if (!isAuthenticated) {
    navigate("/login");
    return;
  }

  return fetchServerData();
};
```
