---
title: Installation
slug: installation
id: installation
---
### System Requirements

* Node version [20.4.0](https://nodejs.org/docs/latest-v20.x/api/index.html) or later
* Supported platforms: macOS, Linux.

For windows users, we recommend using Windows Subsystem for Linux (WSL) for the best development experience.

### Automatic Installation

Execute the following commands in the directory where you wish to set up the Catalyst app:

``` shell title="terminal"
npx create-catalyst-app@latest
```

Upon successful installation, you will see the following prompts in your terminal:

* Enter the name of your Catalyst application
* Enter a description for your application
* Enable TypeScript support? (Y/n)
* Include Tailwind CSS? (Y/n)
* Add MCP (Model Context Protocol) support? (Y/n)
* Choose a state management option

Once the packages are installed, move into the new project folder and start the development server with the following command:

``` shell title="terminal"
cd project-name
npm run start
```

* Navigate to [http://localhost:3005](http://localhost:3005/)

The development server should now be up and running.

### Native Framework Support

Catalyst comes with built-in support for:
* **TypeScript** - Full type safety and modern JavaScript features
* **Tailwind CSS** - Utility-first CSS framework for rapid UI development  
* **Local MCP Server** - Built-in Model Context Protocol server for enhanced development workflow

All these options can be configured when creating an app using `create-catalyst-app` and choosing these options during the setup process.

When you choose the MCP option, a local `mcp.js` file is created and can be linked to any MCP supporting client like Claude Desktop, Cursor, or Deputy Dev.
