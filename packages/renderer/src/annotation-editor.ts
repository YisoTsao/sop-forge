export function renderEditableScript(): string {
  return String.raw`<script>
    (() => {
      const dataElement = document.getElementById('project-data');
      const data = JSON.parse(dataElement?.textContent || '{}');
      const status = document.querySelector('.preview-status');
      const setStatus = (message) => { if (status) status.textContent = message; };
      const clone = (value) => JSON.parse(JSON.stringify(value));
      const exportButton = document.querySelector('[data-export-pdf]');
      exportButton?.addEventListener('click', async () => {
        const popup = window.open('about:blank', '_blank');
        exportButton.disabled = true;
        try {
          const response = await fetch(document.body.dataset.pdfUrl, { method: 'POST' });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Unable to export PDF.');
          if (popup) popup.location.href = result.url;
          else window.location.href = result.url;
          setStatus('PDF exported.');
        } catch (error) {
          popup?.close();
          setStatus(error instanceof Error ? error.message : 'Unable to export PDF.');
        } finally {
          exportButton.disabled = false;
        }
      });
      const persist = async () => {
        const response = await fetch(document.body.dataset.stepsApiUrl, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ steps: data.steps }),
        });
        if (!response.ok) throw new Error('Unable to save step changes.');
        const saved = await response.json();
        data.steps = saved.steps;
      };
      const renumber = () => document.querySelectorAll('.step .number').forEach((number, index) => {
        number.textContent = String(index + 1);
      });
      const updateDescription = (article, value) => {
        let description = article.querySelector('[data-description]');
        if (!description && value) {
          description = document.createElement('p');
          description.className = 'description';
          description.dataset.description = '';
          article.querySelector('[data-editor]').after(description);
        }
        if (description) {
          description.textContent = value;
          description.hidden = !value;
        }
      };

      document.querySelectorAll('.step').forEach((article) => {
        const stepId = article.dataset.stepId;
        let step = data.steps.find((candidate) => candidate.id === stepId);
        const editButton = article.querySelector('.edit-step');
        const editor = article.querySelector('[data-editor]');
        const titleInput = article.querySelector('[data-title-input]');
        const descriptionInput = article.querySelector('[data-description-input]');
        const host = article.querySelector('[data-fabric-editor]');
        if (!step || !editButton || !editor || !titleInput || !descriptionInput || !host) return;
        const documentElement = host.querySelector('[data-editor-document]');
        const initialDocument = JSON.parse(documentElement?.textContent || '{}');
        let savedStep = clone(step);
        let instance;
        try {
          instance = globalThis.SopForgeFabricEditor.mount(host, {
            document: initialDocument,
            onChange(nextDocument) {
              step.editorDocument = nextDocument;
              const active = instance?.canvas?.getActiveObject?.();
              article.querySelectorAll('[data-action="delete"]').forEach((button) => { button.disabled = !active; });
            },
            onStateChange(state) {
              const undo = article.querySelector('[data-action="undo"]');
              const redo = article.querySelector('[data-action="redo"]');
              const deleteButton = article.querySelector('[data-action="delete"]');
              if (undo) undo.disabled = !state.canUndo;
              if (redo) redo.disabled = !state.canRedo;
              if (deleteButton) deleteButton.disabled = !state.hasSelection;
            },
            onToolChange(nextTool) {
              setActiveTool(article.querySelector('[data-tool="' + nextTool + '"]'));
            },
          });
        } catch (error) {
          setStatus(error instanceof Error ? error.message : 'Unable to start screenshot editor.');
          return;
        }
        const tools = [...article.querySelectorAll('[data-tool]')];
        const color = article.querySelector('[data-color]');
        const fill = article.querySelector('[data-fill]');
        const opacity = article.querySelector('[data-opacity]');
        const strokeWidth = article.querySelector('[data-stroke-width]');
        const setActiveTool = (button) => tools.forEach((candidate) => candidate.classList.toggle('active', candidate === button));
        editButton.addEventListener('click', () => { editor.hidden = false; editButton.hidden = true; titleInput.focus(); });
        tools.forEach((button) => button.addEventListener('click', () => { instance.setTool(button.dataset.tool); setActiveTool(button); }));
        color?.addEventListener('input', () => instance.setColor(color.value));
        fill?.addEventListener('input', () => instance.setFill(fill.value));
        opacity?.addEventListener('input', () => instance.setOpacity(opacity.value));
        strokeWidth?.addEventListener('input', () => instance.setStrokeWidth(strokeWidth.value));
        article.querySelector('[data-action="undo"]')?.addEventListener('click', () => instance.undo());
        article.querySelector('[data-action="redo"]')?.addEventListener('click', () => instance.redo());
        article.querySelector('[data-action="delete"]')?.addEventListener('click', () => instance.delete());
        article.querySelector('[data-action="duplicate"]')?.addEventListener('click', () => instance.duplicate());
        article.querySelector('[data-action="bring-forward"]')?.addEventListener('click', () => instance.bringForward());
        article.querySelector('[data-action="send-backward"]')?.addEventListener('click', () => instance.sendBackward());
        article.querySelector('[data-action="download"]')?.addEventListener('click', () => {
          try {
            instance.download((step.title || step.id).replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') + '.png');
            setStatus('Image downloaded.');
          } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to create annotated image.');
          }
        });
        document.addEventListener('keydown', (event) => {
          const canvasFocused = document.activeElement === instance.canvas.upperCanvasEl;
          if (canvasFocused && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            if (event.shiftKey) instance.redo();
            else instance.undo();
            return;
          }
          if (canvasFocused && (event.key === 'Delete' || event.key === 'Backspace') && instance.canvas.getActiveObjects().length) {
            event.preventDefault();
            instance.delete();
          }
        }, true);
        article.querySelector('.cancel-step').addEventListener('click', () => {
          step = clone(savedStep);
          titleInput.value = step.title;
          descriptionInput.value = step.description;
          instance.reset(step.editorDocument || initialDocument);
          article.querySelector('[data-title]').textContent = step.title;
          updateDescription(article, step.description);
          editor.hidden = true;
          editButton.hidden = false;
          setStatus('Changes cancelled.');
        });
        article.querySelector('.save-step').addEventListener('click', async () => {
          const title = titleInput.value.trim();
          if (!title) { setStatus('Title is required.'); return; }
          step.title = title;
          step.description = descriptionInput.value;
          step.editorDocument = instance.serialize();
          article.querySelector('[data-title]').textContent = title;
          updateDescription(article, step.description);
          try {
            await persist();
            step = data.steps.find((candidate) => candidate.id === stepId) || step;
            savedStep = clone(step);
            editor.hidden = true;
            editButton.hidden = false;
            setStatus('Changes saved.');
          } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to save step changes.');
          }
        });
        article.querySelector('.remove-step').addEventListener('click', async () => {
          if (!window.confirm('Remove this step from the SOP?')) return;
          data.steps = data.steps.filter((candidate) => candidate.id !== stepId).map((candidate, index) => ({ ...candidate, order: index }));
          try {
            await persist();
            article.remove();
            renumber();
            setStatus('Step removed.');
          } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to remove step.');
          }
        });
      });
    })();
  </script>`;
}
