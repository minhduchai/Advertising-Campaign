export function renderPreservingEditorScroll(workspace, selectedClientId, renderContent) {
  const selectionId = selectedClientId ?? '';
  const sameSelection = workspace.dataset.renderedSelectionId === selectionId;
  const scrollTop = workspace.querySelector('.workspace-editor')?.scrollTop ?? 0;
  const seedingScrollTop = workspace.querySelector('.workspace-seeding-shell')?.scrollTop ?? 0;
  renderContent();
  workspace.dataset.renderedSelectionId = selectionId;
  const editor = workspace.querySelector('.workspace-editor');
  if (editor && sameSelection) editor.scrollTop = scrollTop;
  const seeding = workspace.querySelector('.workspace-seeding-shell');
  if (seeding && sameSelection) seeding.scrollTop = seedingScrollTop;
}
