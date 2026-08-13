/** Eve connection example: Reelier stays an external authority host. */
export default {
  name: "reelier",
  transport: "stdio",
  command: "reelier",
  args: ["authority", "serve"],
};
