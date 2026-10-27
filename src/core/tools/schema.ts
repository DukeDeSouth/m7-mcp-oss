export const schemaTool = {
  name: "mcp_m7_schema",
  description: "Manage project schema (database, API, architecture) - prevents duplicate databases and maintains project consistency",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["view", "update", "validate", "sync", "diff", "check_db"],
        description: "Schema operation to perform"
      },
      component: {
        type: "string",
        enum: ["database", "api", "architecture", "security", "all"],
        description: "Component to operate on (for view/update actions)",
        optional: true
      },
      changes: {
        type: "object",
        description: "Changes to apply (required for update action)",
        optional: true
      },
      format: {
        type: "string",
        enum: ["yaml", "json", "summary"],
        description: "Output format for view action",
        default: "summary",
        optional: true
      }
    },
    required: ["action"]
  }
};
