/**
 * Build a fast lookup structure from the schema array.
 * Returns: { blockName: { def, optionsByName, subBlocksByName } }
 */
export function buildSchemaLookup(schema) {
  const blocks = {}
  for (const block of schema) {
    blocks[block.name] = {
      def: block,
      optionsByName: Object.fromEntries((block.options || []).map(o => [o.name, o])),
      subBlocksByName: {},
    }
    for (const sub of (block.sub_blocks || [])) {
      blocks[block.name].subBlocksByName[sub.name] = {
        def: sub,
        optionsByName: Object.fromEntries((sub.options || []).map(o => [o.name, o])),
      }
    }
  }
  return blocks
}
