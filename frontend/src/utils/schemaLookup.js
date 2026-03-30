/**
 * schemaLookup.js
 *
 * Converts the flat schema array returned by /api/schema into a fast
 * lookup structure indexed by block name.
 *
 * Used by yamlLineBuilder, yamlValidator, and dependencyChecker to avoid
 * repeated .find() scans over the schema array.
 */

/**
 * Build a lookup map from the schema array.
 *
 * Returns:
 *   {
 *     [blockName]: {
 *       def:             full block definition object,
 *       optionsByName:   { [optName]: option definition },
 *       subBlocksByName: { [subName]: { def, optionsByName } }
 *     }
 *   }
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
