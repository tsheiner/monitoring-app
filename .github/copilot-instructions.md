# GitHub Copilot Instructions

## Playwright MCP QA Requirements

### Core Rule

**NEVER claim a task is complete without verifying it works using Playwright MCP.**

Code that compiles ≠ code that works. Before marking any UI task as done:

1. **Ensure the app is running** (e.g., `npm run dev`)
2. **Navigate to the page** using `mcp_playwright_browser_navigate`
3. **Interact with the UI** to verify the feature actually works
4. **Take a snapshot** using `mcp_playwright_browser_snapshot` to confirm the result

### When to Use Playwright MCP

Use browser testing for:

- Any UI changes (components, pages, layouts)
- Form submissions and validation
- Navigation flows
- Chat interfaces and message flows
- LLM integration verification
- Any feature involving user interaction
- Debugging user-reported issues

Skip browser testing for:

- Backend-only API changes
- Configuration files (package.json, tsconfig.json, etc.)
- Documentation-only changes

### Working with Permission Prompts

GitHub Copilot requires approval for each browser action. To work efficiently:

1. **Ask for a plan first**: "List the steps you'll take to verify this"
2. **Review the plan** before proceeding
3. **Approve actions sequentially** using keyboard shortcuts (Tab + Enter)
4. **Expect to click 5-10 times** for a typical verification workflow

This security feature protects against malicious code - embrace it as a learning opportunity to understand what each browser action does.

### If You Hit Browser Errors

- Use `mcp_playwright_browser_snapshot` to check browser state
- If stuck, close the browser with `mcp_playwright_browser_close` and try again
- Never try to install browsers manually—Playwright handles this via `mcp_playwright_browser_install`
- Always use `mcp_playwright_browser_navigate` for navigation (it manages tabs automatically)

### Completion Standard

A UI task is complete when you have:

- [ ] Implemented the code changes
- [ ] No linter errors introduced
- [ ] Navigated to the page with Playwright MCP (approved each action)
- [ ] Interacted with the feature and verified it works
- [ ] Taken a snapshot confirming the result

### Available Playwright MCP Tools

Key tools you have access to:

- `mcp_playwright_browser_navigate` - Navigate to a URL
- `mcp_playwright_browser_click` - Click elements
- `mcp_playwright_browser_type` - Type into text fields
- `mcp_playwright_browser_fill_form` - Fill multiple form fields
- `mcp_playwright_browser_snapshot` - Get accessibility snapshot (better than screenshot)
- `mcp_playwright_browser_close` - Close browser
- `mcp_playwright_browser_install` - Install browser if needed
- `mcp_playwright_browser_tabs` - Manage browser tabs
