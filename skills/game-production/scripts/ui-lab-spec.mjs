const SPECS = {
  inspector: {
    test: 'real_card_inspector',
    stages: [
      'waiting_inspector_collection',
      'waiting_inspector_open',
      'waiting_inspector_close',
      'waiting_inspector_crafting',
      'waiting_inspector_craft_open',
      'waiting_inspector_craft_close'
    ]
  },
  collection: {
    test: 'real_collection_editor',
    stages: [
      'waiting_collection_new',
      'waiting_collection_add',
      'waiting_collection_remove',
      'waiting_collection_add_again',
      'waiting_collection_complete',
      'waiting_collection_save',
      'waiting_collection_select',
      'waiting_collection_play'
    ]
  },
  shop: {
    test: 'real_shop_purchase',
    stages: ['waiting_shop_open', 'waiting_shop_buy', 'waiting_shop_back', 'waiting_shop_reopen']
  },
  crafting: {
    test: 'real_card_crafting',
    stages: [
      'waiting_craft_open',
      'waiting_craft_recycle',
      'waiting_craft_confirm',
      'waiting_craft_create',
      'waiting_craft_back'
    ]
  }
};
export function uiLabSpec(mode) {
  return Object.hasOwn(SPECS, mode) ? structuredClone(SPECS[mode]) : null;
}
export function assertUiLab(report, mode) {
  const spec = uiLabSpec(mode);
  if (
    !spec ||
    report?.test !== spec.test ||
    report.status !== 'passed' ||
    report.input_source !== 'external_android_input_tap' ||
    report.personal_profile_untouched !== true ||
    !Array.isArray(report.checks) ||
    report.checks.length < spec.stages.length ||
    report.checks.some((c) => c?.ok !== true || typeof c.name !== 'string')
  )
    throw Error('UI lab proof incomplete or failed');
  for (const stage of spec.stages)
    if (report.checks.filter((c) => c.name === stage).length !== 1)
      throw Error('Missing/duplicate UI lab stage');
  return true;
}
