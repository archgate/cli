/** Shared MCP tool response returned when no archgate project is found. */
export function noProjectResponse() {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          error: "no_project",
          message:
            "No archgate project found in this directory or any parent directory.",
          action:
            "Invoke the @archgate:onboard skill to initialize archgate governance in this project. " +
            "It will run 'archgate init', explore the codebase, interview you, and create the initial set of Architecture Decision Records.",
        }),
      },
    ],
  };
}
