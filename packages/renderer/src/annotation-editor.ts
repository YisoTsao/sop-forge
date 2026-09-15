export function renderEditableScript(): string {
  return String.raw`<script>
    (() => {
      const dataElement = document.getElementById('project-data');
      const data = JSON.parse(dataElement.textContent || '{}');
      const status = document.querySelector('.preview-status');
      const setStatus = (message) => { status.textContent = message; };
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
      const clamp = (value) => Math.max(0, Math.min(1, value));
      const svgNamespace = 'http://www.w3.org/2000/svg';

      document.querySelectorAll('.step').forEach((article) => {
        const stepId = article.dataset.stepId;
        let step = data.steps.find((candidate) => candidate.id === stepId);
        if (!step) return;
        const editButton = article.querySelector('.edit-step');
        const editor = article.querySelector('[data-editor]');
        const titleInput = article.querySelector('[data-title-input]');
        const descriptionInput = article.querySelector('[data-description-input]');
        if (!editButton || !editor || !titleInput || !descriptionInput) return;
        const overlay = article.querySelector('[data-overlay]');
        const zoomLayer = article.querySelector('.screenshot-zoom-layer');
        const toolButtons = [...article.querySelectorAll('[data-tool]')];
        const colorInput = article.querySelector('[data-color]');
        const undoButton = article.querySelector('[data-action="undo"]');
        const redoButton = article.querySelector('[data-action="redo"]');
        const deleteButton = article.querySelector('[data-action="delete"]');
        const zoomButtons = [...article.querySelectorAll('[data-zoom]')];
        let selectedId = null;
        let selectedTool = 'select';
        let zoom = 1;
        let pointerState = null;
        let history = [JSON.stringify(step.annotations || [])];
        let historyIndex = 0;

        const annotations = () => step.annotations || (step.annotations = []);
        const pointForEvent = (event) => {
          const bounds = overlay.getBoundingClientRect();
          return {
            x: clamp((event.clientX - bounds.left) / bounds.width),
            y: clamp((event.clientY - bounds.top) / bounds.height),
          };
        };
        const updateHistoryButtons = () => {
          if (undoButton) undoButton.disabled = historyIndex === 0;
          if (redoButton) redoButton.disabled = historyIndex === history.length - 1;
          if (deleteButton) deleteButton.disabled = selectedId === null;
        };
        const recordHistory = (before) => {
          const snapshot = JSON.stringify(annotations());
          if (snapshot === before) return;
          history = history.slice(0, historyIndex + 1);
          history.push(snapshot);
          historyIndex += 1;
          updateHistoryButtons();
        };
        const createNode = (name, annotation) => {
          const node = document.createElementNS(svgNamespace, name);
          node.classList.add('annotation-object');
          node.dataset.annotationId = annotation.id;
          node.dataset.annotationType = annotation.type;
          node.setAttribute('stroke', annotation.color);
          node.setAttribute('vector-effect', 'non-scaling-stroke');
          if (annotation.id === selectedId) node.classList.add('is-selected');
          return node;
        };
        const renderAnnotations = () => {
          if (!overlay) return;
          const defs = overlay.querySelector('defs') || document.createElementNS(svgNamespace, 'defs');
          overlay.replaceChildren(defs);
          defs.replaceChildren();
          annotations().filter((annotation) => annotation.type === 'arrow').forEach((annotation) => {
            const marker = document.createElementNS(svgNamespace, 'marker');
            marker.id = 'annotation-arrowhead-' + annotation.id;
            marker.setAttribute('markerWidth', '0.08');
            marker.setAttribute('markerHeight', '0.08');
            marker.setAttribute('refX', '0.07');
            marker.setAttribute('refY', '0.04');
            marker.setAttribute('orient', 'auto');
            marker.setAttribute('markerUnits', 'userSpaceOnUse');
            const path = document.createElementNS(svgNamespace, 'path');
            path.setAttribute('d', 'M0,0 L0.08,0.04 L0,0.08 z');
            path.setAttribute('fill', annotation.color);
            marker.append(path);
            defs.append(marker);
          });
          annotations().forEach((annotation) => {
            let node;
            if (annotation.type === 'circle') {
              node = createNode('circle', annotation);
              node.setAttribute('cx', annotation.x);
              node.setAttribute('cy', annotation.y);
              node.setAttribute('r', annotation.radius);
              node.setAttribute('fill', 'none');
            } else if (annotation.type === 'rectangle') {
              node = createNode('rect', annotation);
              node.setAttribute('x', annotation.x);
              node.setAttribute('y', annotation.y);
              node.setAttribute('width', annotation.width);
              node.setAttribute('height', annotation.height);
              node.setAttribute('fill', 'none');
            } else if (annotation.type === 'arrow') {
              node = createNode('line', annotation);
              node.setAttribute('x1', annotation.x1);
              node.setAttribute('y1', annotation.y1);
              node.setAttribute('x2', annotation.x2);
              node.setAttribute('y2', annotation.y2);
              node.setAttribute('marker-end', 'url(#annotation-arrowhead-' + annotation.id + ')');
            } else {
              node = createNode('text', annotation);
              node.setAttribute('x', annotation.x);
              node.setAttribute('y', annotation.y);
              node.setAttribute('fill', annotation.color);
              node.setAttribute('font-size', annotation.fontSize);
              node.setAttribute('font-family', 'sans-serif');
              node.setAttribute('dominant-baseline', 'hanging');
              node.textContent = annotation.text;
            }
            node.setAttribute('stroke-width', '0.006');
            overlay.append(node);
          });
          updateHistoryButtons();
        };
        const applyZoom = () => {
          if (!zoomLayer) return;
          zoomLayer.style.width = String(zoom * 100) + '%';
          zoomLayer.style.height = String(zoom * 100) + '%';
        };
        const selectedAnnotation = () => annotations().find((candidate) => candidate.id === selectedId);
        const moveAnnotation = (annotation, dx, dy) => {
          if (annotation.type === 'arrow') {
            annotation.x1 = clamp(pointerState.initial.x1 + dx);
            annotation.y1 = clamp(pointerState.initial.y1 + dy);
            annotation.x2 = clamp(pointerState.initial.x2 + dx);
            annotation.y2 = clamp(pointerState.initial.y2 + dy);
          } else {
            annotation.x = clamp(pointerState.initial.x + dx);
            annotation.y = clamp(pointerState.initial.y + dy);
          }
        };
        const updateDraft = (point) => {
          const annotation = annotations().find((candidate) => candidate.id === pointerState.id);
          if (!annotation) return;
          if (pointerState.mode === 'move') {
            moveAnnotation(annotation, point.x - pointerState.start.x, point.y - pointerState.start.y);
          } else if (annotation.type === 'circle') {
            annotation.radius = Math.max(0.02, Math.min(1, Math.hypot(point.x - pointerState.start.x, point.y - pointerState.start.y)));
          } else if (annotation.type === 'rectangle') {
            annotation.x = Math.min(pointerState.start.x, point.x);
            annotation.y = Math.min(pointerState.start.y, point.y);
            annotation.width = Math.max(0.02, Math.abs(point.x - pointerState.start.x));
            annotation.height = Math.max(0.02, Math.abs(point.y - pointerState.start.y));
          } else if (annotation.type === 'arrow') {
            annotation.x2 = point.x;
            annotation.y2 = point.y;
          }
          renderAnnotations();
        };

        editButton.addEventListener('click', () => { editor.hidden = false; editButton.hidden = true; titleInput.focus(); });
        article.querySelector('.cancel-step').addEventListener('click', () => {
          titleInput.value = step.title;
          descriptionInput.value = step.description;
          editor.hidden = true;
          editButton.hidden = false;
        });
        toolButtons.forEach((button) => button.addEventListener('click', () => {
          selectedTool = button.dataset.tool;
          toolButtons.forEach((candidate) => candidate.classList.toggle('active', candidate === button));
        }));
        colorInput?.addEventListener('input', () => {
          const annotation = selectedAnnotation();
          if (!annotation) return;
          const before = JSON.stringify(annotations());
          annotation.color = colorInput.value;
          recordHistory(before);
          renderAnnotations();
        });
        zoomButtons.forEach((button) => button.addEventListener('click', () => {
          zoom = button.dataset.zoom === 'reset' ? 1 : Math.max(0.5, Math.min(3, zoom + (button.dataset.zoom === 'in' ? 0.25 : -0.25)));
          applyZoom();
        }));
        undoButton?.addEventListener('click', () => {
          if (historyIndex === 0) return;
          historyIndex -= 1;
          step.annotations = JSON.parse(history[historyIndex]);
          selectedId = null;
          renderAnnotations();
        });
        redoButton?.addEventListener('click', () => {
          if (historyIndex === history.length - 1) return;
          historyIndex += 1;
          step.annotations = JSON.parse(history[historyIndex]);
          selectedId = null;
          renderAnnotations();
        });
        deleteButton?.addEventListener('click', () => {
          if (!selectedId) return;
          const before = JSON.stringify(annotations());
          step.annotations = annotations().filter((candidate) => candidate.id !== selectedId);
          selectedId = null;
          recordHistory(before);
          renderAnnotations();
        });
        overlay?.addEventListener('pointerdown', (event) => {
          const target = event.target instanceof Element ? event.target.closest('[data-annotation-id]') : null;
          const point = pointForEvent(event);
          if (selectedTool === 'select' && target) {
            selectedId = target.dataset.annotationId;
            const annotation = selectedAnnotation();
            pointerState = { mode: 'move', id: selectedId, start: point, initial: JSON.parse(JSON.stringify(annotation)) };
            overlay.setPointerCapture(event.pointerId);
            renderAnnotations();
            return;
          }
          if (selectedTool === 'select') {
            selectedId = null;
            renderAnnotations();
            return;
          }
          if (selectedTool === 'text') {
            const text = window.prompt('Text annotation');
            if (!text?.trim()) return;
            const before = JSON.stringify(annotations());
            const annotation = { id: 'text-' + Date.now(), type: 'text', x: point.x, y: point.y, text: text.trim(), color: colorInput?.value || '#ff7a45', fontSize: 0.04 };
            annotations().push(annotation);
            selectedId = annotation.id;
            recordHistory(before);
            renderAnnotations();
            return;
          }
          const id = selectedTool + '-' + Date.now();
          const color = colorInput?.value || '#ff7a45';
          let annotation;
          if (selectedTool === 'circle') annotation = { id, type: 'circle', x: point.x, y: point.y, radius: 0.05, color };
          if (selectedTool === 'rectangle') annotation = { id, type: 'rectangle', x: point.x, y: point.y, width: 0.05, height: 0.05, color };
          if (selectedTool === 'arrow') annotation = { id, type: 'arrow', x1: point.x, y1: point.y, x2: point.x, y2: point.y, color };
          if (!annotation) return;
          const before = JSON.stringify(annotations());
          annotations().push(annotation);
          selectedId = id;
          pointerState = { mode: 'create', id, start: point, before };
          overlay.setPointerCapture(event.pointerId);
          renderAnnotations();
        });
        overlay?.addEventListener('pointermove', (event) => {
          if (!pointerState) return;
          updateDraft(pointForEvent(event));
        });
        overlay?.addEventListener('pointerup', (event) => {
          if (!pointerState) return;
          const before = pointerState.mode === 'create' ? pointerState.before : JSON.stringify(pointerState.initial);
          recordHistory(before);
          pointerState = null;
          overlay.releasePointerCapture(event.pointerId);
          renderAnnotations();
        });
        article.querySelector('.save-step').addEventListener('click', async () => {
          const title = titleInput.value.trim();
          if (!title) { setStatus('Title is required.'); return; }
          step.title = title;
          step.description = descriptionInput.value;
          article.querySelector('[data-title]').textContent = title;
          let description = article.querySelector('[data-description]');
          if (!description && step.description) {
            description = document.createElement('p');
            description.className = 'description';
            description.dataset.description = '';
            article.querySelector('[data-editor]').after(description);
          }
          if (description) description.textContent = step.description;
          try {
            await persist();
            step = data.steps.find((candidate) => candidate.id === stepId) || step;
            editor.hidden = true;
            editButton.hidden = false;
            setStatus('Changes saved.');
          } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to save step changes.');
          }
        });
        article.querySelector('.remove-step').addEventListener('click', async () => {
          if (!window.confirm('Remove this step from the SOP?')) return;
          const remaining = data.steps.filter((candidate) => candidate.id !== stepId).map((candidate, index) => ({ ...candidate, order: index }));
          data.steps = remaining;
          try {
            await persist();
            article.remove();
            renumber();
            setStatus('Step removed.');
          } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to remove step.');
          }
        });
        renderAnnotations();
        applyZoom();
      });
    })();
  </script>`;
}
