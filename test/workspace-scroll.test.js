import test from 'node:test';
import assert from 'node:assert/strict';

const workspaceView = await import('../public/workspace-view.js').catch(() => ({}));

test('keeps the editor scroll position when the selected node rerenders', () => {
  assert.equal(typeof workspaceView.renderPreservingEditorScroll, 'function');

  const workspace = fakeWorkspace({ selectedClientId: 'adset-1', scrollTop: 640 });

  workspaceView.renderPreservingEditorScroll(workspace, 'adset-1', () => {
    workspace.replaceEditor();
  });

  assert.equal(workspace.editor.scrollTop, 640);
});

test('starts a newly selected node at the top of the editor', () => {
  const workspace = fakeWorkspace({ selectedClientId: 'adset-1', scrollTop: 640 });

  workspaceView.renderPreservingEditorScroll(workspace, 'ad-1', () => {
    workspace.replaceEditor();
  });

  assert.equal(workspace.editor.scrollTop, 0);
});

test('keeps the seeding workspace scroll position when it rerenders', () => {
  const workspace = fakeWorkspace({ selectedClientId: 'campaign-1', scrollTop: 0, seedingScrollTop: 920 });

  workspaceView.renderPreservingEditorScroll(workspace, 'campaign-1', () => {
    workspace.replaceEditor();
  });

  assert.equal(workspace.seeding.scrollTop, 920);
});

function fakeWorkspace({ selectedClientId, scrollTop, seedingScrollTop = 0 }) {
  let editor = { scrollTop };
  let seeding = { scrollTop: seedingScrollTop };
  return {
    dataset: { renderedSelectionId: selectedClientId },
    get editor() {
      return editor;
    },
    get seeding() {
      return seeding;
    },
    querySelector(selector) {
      if (selector === '.workspace-editor') return editor;
      if (selector === '.workspace-seeding-shell') return seeding;
      return null;
    },
    replaceEditor() {
      editor = { scrollTop: 0 };
      seeding = { scrollTop: 0 };
    }
  };
}
