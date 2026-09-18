export function renderFabricEditorRuntime(): string {
  return String.raw`<script>
    (() => {
      const fabricApi = globalThis.fabric;
      const clamp = (value, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));
      const clone = (value) => JSON.parse(JSON.stringify(value));
      const makeId = (type) => type + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      const colorWithAlpha = (value, alpha) => {
        if (!value || value.startsWith('rgba(')) return value;
        const match = value.match(/^#([0-9a-f]{6})$/i);
        if (!match) return value;
        const red = parseInt(match[1].slice(0, 2), 16);
        const green = parseInt(match[1].slice(2, 4), 16);
        const blue = parseInt(match[1].slice(4, 6), 16);
        return 'rgba(' + red + ',' + green + ',' + blue + ',' + alpha + ')';
      };
      const Arrow = fabricApi ? class Arrow extends fabricApi.Line {
        constructor(points, options) {
          super(points, options);
          this.type = 'arrow';
        }
        _render(context) {
          super._render(context);
          const points = this.calcLinePoints();
          const angle = Math.atan2(points.y2 - points.y1, points.x2 - points.x1);
          const headLength = Math.max(10, this.strokeWidth * 3.5);
          const headWidth = headLength * 0.55;
          context.save();
          context.translate(points.x2, points.y2);
          context.rotate(angle);
          context.fillStyle = this.stroke || '#ff7a45';
          context.beginPath();
          context.moveTo(0, 0);
          context.lineTo(-headLength, headWidth);
          context.lineTo(-headLength, -headWidth);
          context.closePath();
          context.fill();
          context.restore();
        }
      } : null;
      const Marker = fabricApi ? class Marker extends fabricApi.Circle {
        constructor(options) {
          super(options);
          this.type = 'marker';
        }
        _render(context) {
          super._render(context);
          const label = this.__sopForge?.label || '1';
          context.save();
          context.fillStyle = this.stroke || '#ff7a45';
          context.font = 'bold ' + Math.max(12, this.radius * 0.9) + 'px sans-serif';
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.fillText(label, 0, 0);
          context.restore();
        }
      } : null;
      const defaultStyle = (style = {}, color = '#ff7a45') => ({
        stroke: style.stroke || color,
        fill: style.fill,
        opacity: typeof style.opacity === 'number' ? style.opacity : 1,
        strokeWidth: style.strokeWidth || 0.006,
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        textAlign: style.textAlign,
      });
      const pointForEvent = (canvas, event) => canvas.getScenePoint
        ? canvas.getScenePoint(event.e)
        : canvas.getPointer(event.e);
      const setMeta = (object, descriptor) => {
        object.__sopForge = {
          id: descriptor.id,
          editorType: descriptor.editorType,
          style: clone(descriptor.style),
          mode: descriptor.mode,
          startHead: descriptor.startHead,
          endHead: descriptor.endHead,
          label: descriptor.label,
        };
        return object;
      };
      const styleForObject = (object, width) => ({
        stroke: object.stroke || object.__sopForge?.style?.stroke || '#ff7a45',
        fill: object.fill && object.fill !== 'transparent' ? object.fill : undefined,
        opacity: typeof object.opacity === 'number' ? object.opacity : 1,
        strokeWidth: (object.strokeWidth || width * 0.006) / width,
        fontSize: object.fontSize ? object.fontSize / width : object.__sopForge?.style?.fontSize,
        fontFamily: object.fontFamily || object.__sopForge?.style?.fontFamily,
        fontWeight: object.fontWeight || object.__sopForge?.style?.fontWeight,
        textAlign: object.textAlign || object.__sopForge?.style?.textAlign,
      });
      const fabricObjectFromDescriptor = (descriptor, width) => {
        const style = descriptor.style || defaultStyle();
        const common = {
          angle: descriptor.angle || 0,
          opacity: style.opacity,
          stroke: style.stroke,
          strokeWidth: Math.max(1, style.strokeWidth * width),
          fill: style.fill || 'transparent',
            hoverCursor: 'move',
            moveCursor: 'move',
          selectable: !descriptor.locked,
          evented: !descriptor.locked,
        };
        if (descriptor.editorType === 'circle') {
          return setMeta(new fabricApi.Ellipse({ ...common, left: descriptor.left, top: descriptor.top, rx: descriptor.radiusX, ry: descriptor.radiusY, originX: 'center', originY: 'center' }), descriptor);
        }
        if (descriptor.editorType === 'rectangle' || descriptor.editorType === 'redaction' || descriptor.editorType === 'callout') {
          return setMeta(new fabricApi.Rect({ ...common, left: descriptor.left, top: descriptor.top, width: descriptor.width, height: descriptor.height, originX: 'left', originY: 'top', fill: descriptor.editorType === 'redaction' ? (style.fill && style.fill !== 'transparent' ? style.fill : '#ffffff') : common.fill }), descriptor);
        }
        if (descriptor.editorType === 'arrow') {
          return setMeta(new Arrow([descriptor.x1, descriptor.y1, descriptor.x2, descriptor.y2], { ...common, fill: 'transparent' }), descriptor);
        }
        if (descriptor.editorType === 'line') {
          return setMeta(new fabricApi.Line([descriptor.x1, descriptor.y1, descriptor.x2, descriptor.y2], { ...common, fill: 'transparent' }), descriptor);
        }
        if (descriptor.editorType === 'path') {
          const path = (descriptor.points || []).map((point, index) => [index === 0 ? 'M' : 'L', point.x, point.y]);
          return setMeta(new fabricApi.Path(path, { ...common, fill: 'transparent', strokeLineCap: 'round', strokeLineJoin: 'round' }), descriptor);
        }
        if (descriptor.editorType === 'text') {
          return setMeta(new fabricApi.IText(descriptor.text || 'Text', { ...common, left: descriptor.left, top: descriptor.top, fill: style.stroke, fontSize: (style.fontSize || 0.04) * width, fontFamily: style.fontFamily || 'sans-serif', fontWeight: style.fontWeight || 400, originX: 'left', originY: 'top' }), descriptor);
        }
        return setMeta(new Marker({ ...common, left: descriptor.left, top: descriptor.top, radius: width * 0.035, originX: 'center', originY: 'center' }), descriptor);
      };
      const descriptorFromFabricObject = (object, width, height) => {
        const meta = object.__sopForge || {};
        const editorType = meta.editorType || (object.type === 'i-text' ? 'text' : object.type === 'ellipse' ? 'circle' : 'rectangle');
        const base = {
          id: meta.id || makeId(editorType),
          editorType,
          angle: object.angle || 0,
          style: styleForObject(object, width),
          mode: meta.mode,
          startHead: meta.startHead,
          endHead: meta.endHead,
          label: meta.label,
        };
        if (editorType === 'circle') return { ...base, left: object.left, top: object.top, radiusX: object.rx * (object.scaleX || 1), radiusY: object.ry * (object.scaleY || 1) };
        if (editorType === 'rectangle' || editorType === 'redaction' || editorType === 'callout') return { ...base, left: object.left, top: object.top, width: object.width * (object.scaleX || 1), height: object.height * (object.scaleY || 1) };
        if (editorType === 'line' || editorType === 'arrow') {
          const points = object.calcLinePoints ? object.calcLinePoints() : { x1: object.x1, y1: object.y1, x2: object.x2, y2: object.y2 };
          return { ...base, x1: points.x1 + object.left, y1: points.y1 + object.top, x2: points.x2 + object.left, y2: points.y2 + object.top };
        }
        if (editorType === 'path') {
          const points = (object.path || []).map((command) => ({ x: command[1], y: command[2] })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
          return { ...base, points };
        }
        if (editorType === 'text') return { ...base, left: object.left, top: object.top, text: object.text || 'Text' };
        return { ...base, left: object.left, top: object.top, label: meta.label || '1' };
      };
      const objectToEditor = (descriptor, document) => {
        const width = document.source.width;
        const height = document.source.height;
        const base = { id: descriptor.id, rotation: descriptor.angle || 0, style: descriptor.style };
        if (descriptor.editorType === 'circle') return { ...base, type: 'circle', x: descriptor.left / width, y: descriptor.top / height, radius: descriptor.radiusX / width };
        if (descriptor.editorType === 'rectangle') return { ...base, type: 'rectangle', x: descriptor.left / width, y: descriptor.top / height, width: descriptor.width / width, height: descriptor.height / height };
        if (descriptor.editorType === 'redaction') return { ...base, type: 'redaction', x: descriptor.left / width, y: descriptor.top / height, width: descriptor.width / width, height: descriptor.height / height, mode: descriptor.mode === 'pixelate' ? 'pixelate' : 'solid' };
        if (descriptor.editorType === 'line' || descriptor.editorType === 'arrow') return { ...base, type: descriptor.editorType, x1: descriptor.x1 / width, y1: descriptor.y1 / height, x2: descriptor.x2 / width, y2: descriptor.y2 / height, startHead: descriptor.startHead, endHead: descriptor.endHead };
        if (descriptor.editorType === 'path') return { ...base, type: 'path', points: descriptor.points.map((point) => ({ x: clamp(point.x / width), y: clamp(point.y / height) })), mode: descriptor.mode === 'highlighter' ? 'highlighter' : 'pen' };
        if (descriptor.editorType === 'text') return { ...base, type: 'text', x: descriptor.left / width, y: descriptor.top / height, text: descriptor.text || 'Text' };
        return { ...base, type: 'marker', x: descriptor.left / width, y: descriptor.top / height, label: descriptor.label || '1' };
      };

      globalThis.SopForgeFabricEditor = {
        mount(host, options = {}) {
          if (!fabricApi) throw new Error('Fabric.js runtime is unavailable.');
          const canvasElement = host.querySelector('canvas');
          if (!canvasElement) throw new Error('Fabric canvas element is missing.');
          const width = Number(host.dataset.imageWidth || options.document?.source?.width || 1);
          const height = Number(host.dataset.imageHeight || options.document?.source?.height || 1);
          const canvas = new fabricApi.Canvas(canvasElement, { preserveObjectStacking: true, selection: true });
          canvas.setDimensions({ width, height }, { backstoreOnly: true });
          canvas.upperCanvasEl.tabIndex = 0;
          canvas.upperCanvasEl.setAttribute('aria-label', 'Screenshot annotation canvas');
          canvas.wrapperEl.style.position = 'absolute';
          canvas.wrapperEl.style.inset = '0';
          canvas.wrapperEl.style.width = '100%';
          canvas.wrapperEl.style.height = '100%';
          [canvas.lowerCanvasEl, canvas.upperCanvasEl].forEach((element) => {
            element.style.width = '100%';
            element.style.height = '100%';
          });
          let document = clone(options.document);
          let tool = 'select';
          let color = options.color || '#ff7a45';
          let fill = options.fill || 'transparent';
          let opacity = 1;
          let strokeWidth = 0.006;
          let drawing = null;
          let loading = false;
          let history = [];
          let historyIndex = -1;
          const active = () => canvas.getActiveObject();
          const notify = () => {
            options.onChange?.(clone(document));
            options.onStateChange?.({ canUndo: historyIndex > 0, canRedo: historyIndex < history.length - 1, hasSelection: Boolean(active()) });
          };
          const syncDocument = () => {
            const descriptors = canvas.getObjects().map((object) => descriptorFromFabricObject(object, width, height));
            document = { ...document, objects: descriptors.map((descriptor) => objectToEditor(descriptor, document)) };
            notify();
          };
          const snapshot = () => JSON.stringify(document);
          const record = () => {
            const value = snapshot();
            if (history[historyIndex] === value) return;
            history = history.slice(0, historyIndex + 1);
            history.push(value);
            historyIndex += 1;
            notify();
          };
          const load = (nextDocument) => {
            loading = true;
            canvas.clear();
            document = clone(nextDocument);
            (document.objects || []).forEach((object) => {
              const descriptor = globalThis.SopForgeFabricEditor.documentToDescriptor(document, object);
              canvas.add(fabricObjectFromDescriptor(descriptor, width));
            });
            loading = false;
            canvas.requestRenderAll();
            notify();
          };
          const mutate = (callback) => { callback(); syncDocument(); record(); canvas.requestRenderAll(); };
          const setActiveStyle = (changes) => {
            const object = active();
            if (!object) return;
            object.set(changes);
            object.__sopForge.style = { ...object.__sopForge.style, ...changes };
            mutate(() => {});
          };
          const updateCursor = () => {
            canvas.defaultCursor = tool === 'select' ? 'default' : 'crosshair';
            canvas.hoverCursor = tool === 'select' ? 'default' : 'crosshair';
          };
          canvas.on('mouse:down', (event) => {
            canvas.upperCanvasEl.focus({ preventScroll: true });
            if (event.target && tool !== 'select') {
              tool = 'select';
              canvas.isDrawingMode = false;
              updateCursor();
              canvas.setActiveObject(event.target);
              options.onToolChange?.('select');
              return;
            }
            if (tool === 'select' || tool === 'pen' || tool === 'highlighter') return;
            const point = pointForEvent(canvas, event);
            const style = defaultStyle({ stroke: color, fill, opacity, strokeWidth });
            let descriptor = { id: makeId(tool), editorType: tool, left: point.x, top: point.y, width: 1, height: 1, angle: 0, style };
            if (tool === 'circle') descriptor = { ...descriptor, editorType: 'circle', left: point.x, top: point.y, radiusX: 1, radiusY: 1 };
            if (tool === 'line' || tool === 'arrow') descriptor = { ...descriptor, editorType: tool, x1: point.x, y1: point.y, x2: point.x, y2: point.y };
            const object = fabricObjectFromDescriptor(descriptor, width);
            canvas.add(object);
            canvas.setActiveObject(object);
            drawing = { object, start: point };
          });
          canvas.on('mouse:move', (event) => {
            if (!drawing) return;
            const point = pointForEvent(canvas, event);
            const start = drawing.start;
            if (tool === 'rectangle' || tool === 'redaction') drawing.object.set({ left: Math.min(start.x, point.x), top: Math.min(start.y, point.y), width: Math.max(2, Math.abs(point.x - start.x)), height: Math.max(2, Math.abs(point.y - start.y)) });
            if (tool === 'circle') drawing.object.set({ rx: Math.max(2, Math.abs(point.x - start.x)), ry: Math.max(2, Math.abs(point.y - start.y)) });
            if (tool === 'line' || tool === 'arrow') drawing.object.set({ x2: point.x, y2: point.y });
            drawing.object.setCoords();
            canvas.requestRenderAll();
          });
          canvas.on('mouse:up', () => { if (drawing) { drawing = null; syncDocument(); record(); } });
          canvas.on('object:modified', () => { if (!loading) { syncDocument(); record(); } });
          canvas.on('mouse:over', ({ target }) => { if (target) target.set({ hoverCursor: 'move', moveCursor: 'move' }); });
          canvas.on('selection:created', notify);
          canvas.on('selection:updated', notify);
          canvas.on('selection:cleared', notify);
          canvas.on('object:removed', () => { if (!loading) notify(); });
          canvas.on('path:created', (event) => {
            const brushWidth = strokeWidth * (tool === 'highlighter' ? 3.5 : 1);
            const pathOpacity = tool === 'highlighter' ? 0.35 : opacity;
            event.path.set({ stroke: color, opacity: pathOpacity, strokeWidth: Math.max(2, brushWidth * width) });
            event.path.__sopForge = { id: makeId('path'), editorType: 'path', style: defaultStyle({ stroke: color, opacity: pathOpacity, strokeWidth: brushWidth }), mode: tool === 'highlighter' ? 'highlighter' : 'pen' };
            event.path.setCoords();
            syncDocument();
            record();
          });
          const updateBrush = () => {
            if (!canvas.freeDrawingBrush && fabricApi.PencilBrush) canvas.freeDrawingBrush = new fabricApi.PencilBrush(canvas);
            if (!canvas.freeDrawingBrush) return;
            canvas.freeDrawingBrush.color = tool === 'highlighter' ? colorWithAlpha(color, 0.35) : colorWithAlpha(color, opacity);
            canvas.freeDrawingBrush.width = Math.max(2, strokeWidth * width * (tool === 'highlighter' ? 3.5 : 1));
          };
          const setTool = (nextTool) => {
            tool = nextTool;
            canvas.isDrawingMode = nextTool === 'pen' || nextTool === 'highlighter';
            updateCursor();
            updateBrush();
          };
          load(document);
          history = [snapshot()];
          historyIndex = 0;
          updateCursor();
          notify();
          return {
            canvas,
            setTool,
            setColor(value) { color = value; updateBrush(); setActiveStyle({ stroke: value }); },
            setFill(value) { fill = value; setActiveStyle({ fill: value }); },
            setOpacity(value) { opacity = Number(value); updateBrush(); setActiveStyle({ opacity }); },
            setStrokeWidth(value) { strokeWidth = Number(value); updateBrush(); setActiveStyle({ strokeWidth: strokeWidth * width }); },
            undo() { if (historyIndex <= 0) return; historyIndex -= 1; load(JSON.parse(history[historyIndex])); notify(); },
            redo() { if (historyIndex >= history.length - 1) return; historyIndex += 1; load(JSON.parse(history[historyIndex])); notify(); },
            delete() { const objects = canvas.getActiveObjects(); if (objects.length) mutate(() => { objects.forEach((object) => canvas.remove(object)); canvas.discardActiveObject(); }); },
            duplicate() { const object = active(); if (!object) return; object.clone().then((copy) => { copy.set({ left: (copy.left || 0) + 20, top: (copy.top || 0) + 20 }); copy.__sopForge = { ...clone(object.__sopForge), id: makeId(object.__sopForge?.editorType || 'object') }; canvas.add(copy); canvas.setActiveObject(copy); mutate(() => {}); }); },
            bringForward() { const object = active(); if (object) mutate(() => canvas.bringObjectToFront(object)); },
            sendBackward() { const object = active(); if (object) mutate(() => canvas.sendObjectToBack(object)); },
            serialize() { syncDocument(); return clone(document); },
            reset(nextDocument) { load(nextDocument); history = [snapshot()]; historyIndex = 0; },
            download(filename) {
              const image = host.querySelector('img');
              if (!image || !image.complete || !image.naturalWidth) throw new Error('Image is not ready to download.');
              const output = globalThis.document.createElement('canvas');
              output.width = image.naturalWidth;
              output.height = image.naturalHeight;
              const context = output.getContext('2d');
              if (!context) throw new Error('Unable to create image canvas.');
              context.drawImage(image, 0, 0, output.width, output.height);
              const overlay = new Image();
              overlay.onload = () => { context.drawImage(overlay, 0, 0, output.width, output.height); const link = globalThis.document.createElement('a'); link.download = filename; link.href = output.toDataURL('image/png'); link.click(); };
              overlay.src = canvas.toDataURL({ format: 'png', multiplier: image.naturalWidth / width });
            },
          };
        },
        documentToDescriptor(document, object) {
          const width = document.source.width;
          const height = document.source.height;
          const style = object.style || defaultStyle();
          const base = { ...object, style, angle: object.rotation || 0 };
          if (object.type === 'circle') return { ...base, editorType: 'circle', left: object.x * width, top: object.y * height, radiusX: object.radius * width, radiusY: object.radius * height };
          if (object.type === 'rectangle' || object.type === 'redaction' || object.type === 'callout') return { ...base, editorType: object.type, left: object.x * width, top: object.y * height, width: object.width * width, height: object.height * height, mode: object.mode };
          if (object.type === 'line' || object.type === 'arrow') return { ...base, editorType: object.type, x1: object.x1 * width, y1: object.y1 * height, x2: object.x2 * width, y2: object.y2 * height, startHead: object.startHead, endHead: object.endHead };
          if (object.type === 'path') return { ...base, editorType: 'path', points: object.points.map((point) => ({ x: point.x * width, y: point.y * height })), mode: object.mode };
          if (object.type === 'text') return { ...base, editorType: 'text', left: object.x * width, top: object.y * height, text: object.text };
          return { ...base, editorType: 'marker', left: object.x * width, top: object.y * height, label: object.label };
        },
      };
    })();
  </script>`;
}
