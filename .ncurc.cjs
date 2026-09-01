// ncu does not merge this with ~/.ncurc.json, so the global cooldown is restated here.
module.exports = {
  cooldown: 1,
  reject: [
    // Held at the oldest major in engines.node on purpose. Typing against a newer
    // major would let a Node 26-only API compile here and throw for a user on 22.
    "@types/node",
  ],
};
