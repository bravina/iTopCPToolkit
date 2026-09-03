/**
 * schemaLookup.js
 *
 * Converts a (effective) block list into a fast lookup indexed by block name.
 * Used by yamlLineBuilder, yamlValidator, dependencyChecker and yamlToConfig.
 *
 * Returns:
 *   {
 *     [blockName]: {
 *       def:             full block definition object,
 *       optionsByName:   { [optName]: option definition },
 *       subBlocksByName: { [subName]: { def, optionsByName } }
 *     }
 *   }
 *
 * The AddConfigBlocks pseudo-block is always present.
 */

import { ADD_CONFIG_BLOCKS_DEF } from './schema.js'

function index(list) {
  return Object.fromEntries((list || []).map(o => [o.name, o]))
}

export function buildSchemaLookup(blocks) {
  const lookup = {}
  for (const block of [ADD_CONFIG_BLOCKS_DEF, ...(blocks || [])]) {
    lookup[block.name] = {
      def: block,
      optionsByName: index(block.options),
      subBlocksByName: Object.fromEntries(
        (block.subBlocks || []).map(sub => [sub.name, { def: sub, optionsByName: index(sub.options) }])
      ),
    }
  }
  return lookup
}
