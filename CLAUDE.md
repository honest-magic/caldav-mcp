## Project

**CalDAV MCP Server**

A local Model Context Protocol (MCP) server that provides tools to interact with calendars via CalDAV. It allows AI models to list, read, create, update, and delete calendar events.

**Core Value:** Empower AI agents to act as a personal calendar assistant by providing structured, tool-based access to existing calendar accounts through CalDAV.

### Constraints

- **Protocol**: Must use CalDAV for broad compatibility.
- **Environment**: Must run locally on macOS (Darwin).
- **Interface**: Must adhere to the Model Context Protocol (MCP) specification.

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
