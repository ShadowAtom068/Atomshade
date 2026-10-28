'use client';

import { I } from './Icons';
import { useCallback, useEffect, useRef, useState } from 'react';

// A small photo editor: crop, rotate, flip, draw, text and filters.
// Everything happens on this device. Nothing is uploaded until you tap the final button.

const MAX_SIDE = 1600;
const COLORS = ['#ffffff', '#000000', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];
const FILTERS = [
  ['none', 'Original'],
  ['mono', 'B&W'],
  ['sepia', 'Sepia'],
  ['warm', 'Warm'],
  ['cool', 'Cool'],
  ['vivid', 'Vivid'],
  ['fade', 'Fade'],
];
const RATIOS = [
  ['free', 'Free', null],
  ['1:1', '1:1', 1],
  ['4:5', '4:5', 4 / 5],
  ['3:4', '3:4', 3 / 4],
  ['16:9', '16:9', 16 / 9],
  ['9:16', '9:16', 9 / 16],
];

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
function copyCanvas(src) {
  const c = makeCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

// Colour changes done by hand so they work in every browser (Safari included).
function filtered(src, name, bright) {
  if (name === 'none' && !bright) return src;
  const out = copyCanvas(src);
  const ctx = out.getContext('2d');
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  const add = bright * 2;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    if (name === 'mono') {
      r = g = b = l;
    } else if (name === 'sepia') {
      const nr = 0.393 * r + 0.769 * g + 0.189 * b;
      const ng = 0.349 * r + 0.686 * g + 0.168 * b;
      const nb = 0.272 * r + 0.534 * g + 0.131 * b;
      r = nr; g = ng; b = nb;
    } else if (name === 'warm') {
      r = r * 1.1 + 6; g = g * 1.02; b = b * 0.88;
    } else if (name === 'cool') {
      r = r * 0.9; g = g * 1.02; b = b * 1.12 + 6;
    } else if (name === 'vivid') {
      r = l + (r - l) * 1.4; g = l + (g - l) * 1.4; b = l + (b - l) * 1.4;
      r = (r - 128) * 1.1 + 128; g = (g - 128) * 1.1 + 128; b = (b - 128) * 1.1 + 128;
    } else if (name === 'fade') {
      r = (r - 128) * 0.78 + 142; g = (g - 128) * 0.78 + 142; b = (b - 128) * 0.78 + 146;
    }
    d[i] = r + add;
    d[i + 1] = g + add;
    d[i + 2] = b + add;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function drawTexts(ctx, W, texts) {
  texts.forEach((t) => {
    const px = Math.max(10, t.size * W);
    ctx.font = `700 ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = px * 0.14;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    const x = t.x * ctx.canvas.width;
    const y = t.y * ctx.canvas.height;
    ctx.strokeText(t.text, x, y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, x, y);
  });
}

export default function MediaEditor({ file, onDone, onCancel, onError, doneLabel = 'Done' }) {
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState('crop'); // crop | draw | text | filter
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const work = useRef(null); // the picture being edited
  const undoStack = useRef([]);
  const display = useRef(null);
  const wrap = useRef(null);
  const [dispW, setDispW] = useState(300);

  const [filter, setFilter] = useState('none');
  const [bright, setBright] = useState(0);
  const [color, setColor] = useState(COLORS[2]);
  const [brush, setBrush] = useState(0.012);
  const drawing = useRef(null);

  const [ratio, setRatio] = useState('free');
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const cropDrag = useRef(null);

  const [texts, setTexts] = useState([]);
  const [textInput, setTextInput] = useState('');
  const [textSize, setTextSize] = useState(0.075);
  const textDrag = useRef(null);
  const [busy, setBusy] = useState(false);

  // ----- load the picture -----
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        let bmp;
        try {
          bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch {
          bmp = await createImageBitmap(file);
        }
        const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
        const c = makeCanvas(bmp.width * scale, bmp.height * scale);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        if (bmp.close) bmp.close();
        if (dead) return;
        work.current = c;
        setReady(true);
      } catch (e) {
        if (!dead && onError) onError(e);
      }
    })();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // ----- show the picture -----
  const render = useCallback(() => {
    const src = work.current;
    const cv = display.current;
    if (!src || !cv) return;
    const out = filtered(src, filter, bright);
    if (cv.width !== out.width || cv.height !== out.height) {
      cv.width = out.width;
      cv.height = out.height;
    }
    cv.getContext('2d').drawImage(out, 0, 0);
  }, [filter, bright]);

  useEffect(() => {
    if (ready) render();
  }, [ready, render, tool]);

  useEffect(() => {
    if (!ready || !display.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setDispW(display.current ? display.current.clientWidth : 300));
    ro.observe(display.current);
    return () => ro.disconnect();
  }, [ready]);

  function snapshot() {
    undoStack.current.push(copyCanvas(work.current));
    if (undoStack.current.length > 10) undoStack.current.shift();
  }
  function undo() {
    const prev = undoStack.current.pop();
    if (!prev) return;
    work.current = prev;
    resetCrop(ratio);
    bump();
    render();
  }

  function pointIn(e) {
    const r = display.current.getBoundingClientRect();
    return { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height, r };
  }

  // ----- text -----
  function commitTexts() {
    if (!texts.length) return;
    snapshot();
    const ctx = work.current.getContext('2d');
    drawTexts(ctx, work.current.width, texts);
    setTexts([]);
    render();
  }
  function addText() {
    const t = textInput.trim();
    if (!t) return;
    setTexts((list) => [...list, { id: Math.random().toString(36).slice(2), text: t.slice(0, 80), x: 0.5, y: 0.5, color, size: textSize }]);
    setTextInput('');
  }
  function textDown(e, id) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    textDrag.current = id;
  }
  function textMove(e) {
    if (!textDrag.current) return;
    const { fx, fy } = pointIn(e);
    const id = textDrag.current;
    setTexts((list) => list.map((t) => (t.id === id ? { ...t, x: Math.min(1, Math.max(0, fx)), y: Math.min(1, Math.max(0, fy)) } : t)));
  }
  function textUp() {
    textDrag.current = null;
  }

  // ----- switching tools -----
  function pickTool(next) {
    if (next === tool) return;
    if (tool === 'text') commitTexts();
    if (tool === 'crop') resetCrop(ratio);
    setTool(next);
  }

  // ----- rotate / flip -----
  function rotate() {
    commitTexts();
    snapshot();
    const s = work.current;
    const c = makeCanvas(s.height, s.width);
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(s, -s.width / 2, -s.height / 2);
    work.current = c;
    resetCrop('free');
    setRatio('free');
    bump();
    render();
  }
  function flip() {
    commitTexts();
    snapshot();
    const s = work.current;
    const c = makeCanvas(s.width, s.height);
    const ctx = c.getContext('2d');
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(s, 0, 0);
    work.current = c;
    bump();
    render();
  }

  // ----- crop -----
  function resetCrop(id) {
    setRatio(id);
    const r = RATIOS.find((x) => x[0] === id)[2];
    const W = work.current ? work.current.width : 1;
    const H = work.current ? work.current.height : 1;
    if (!r) return setCrop({ x: 0, y: 0, w: 1, h: 1 });
    let w;
    let h;
    if (W / H > r) {
      h = 1;
      w = (H * r) / W;
    } else {
      w = 1;
      h = W / r / H;
    }
    setCrop({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
  }
  function cropDown(e, mode) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    cropDrag.current = { mode, start: { ...crop }, p0: pointIn(e) };
  }
  function cropMove(e) {
    const d = cropDrag.current;
    if (!d) return;
    const { fx, fy } = pointIn(e);
    const clamp = (v) => Math.min(1, Math.max(0, v));
    if (d.mode === 'move') {
      const dx = fx - d.p0.fx;
      const dy = fy - d.p0.fy;
      setCrop({
        ...d.start,
        x: Math.min(1 - d.start.w, Math.max(0, d.start.x + dx)),
        y: Math.min(1 - d.start.h, Math.max(0, d.start.y + dy)),
      });
      return;
    }
    const s = d.start;
    const left = d.mode.includes('w');
    const top = d.mode.includes('n');
    const ax = left ? s.x + s.w : s.x; // the corner that stays still
    const ay = top ? s.y + s.h : s.y;
    let mx = clamp(fx);
    let my = clamp(fy);
    const lock = RATIOS.find((x) => x[0] === ratio)[2];
    const W = work.current.width;
    const H = work.current.height;
    if (lock) {
      let wf = Math.abs(mx - ax);
      let hf = (wf * W) / (lock * H);
      const maxH = top ? ay : 1 - ay;
      if (hf > maxH) {
        hf = maxH;
        wf = (hf * lock * H) / W;
      }
      const maxW = left ? ax : 1 - ax;
      if (wf > maxW) {
        wf = maxW;
        hf = (wf * W) / (lock * H);
      }
      mx = left ? ax - wf : ax + wf;
      my = top ? ay - hf : ay + hf;
    }
    let x = Math.min(ax, mx);
    let y = Math.min(ay, my);
    let w = Math.abs(mx - ax);
    let h = Math.abs(my - ay);
    if (w < 0.06 || h < 0.06) return;
    setCrop({ x, y, w, h });
  }
  function cropUp() {
    cropDrag.current = null;
  }
  function applyCrop() {
    const s = work.current;
    const sx = Math.round(crop.x * s.width);
    const sy = Math.round(crop.y * s.height);
    const sw = Math.max(1, Math.round(crop.w * s.width));
    const sh = Math.max(1, Math.round(crop.h * s.height));
    snapshot();
    const c = makeCanvas(sw, sh);
    c.getContext('2d').drawImage(s, sx, sy, sw, sh, 0, 0, sw, sh);
    work.current = c;
    setRatio('free');
    setCrop({ x: 0, y: 0, w: 1, h: 1 });
    bump();
    render();
  }

  // ----- draw -----
  function drawDown(e) {
    if (tool !== 'draw') return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    snapshot();
    const { fx, fy } = pointIn(e);
    drawing.current = { x: fx * work.current.width, y: fy * work.current.height };
    const ctx = work.current.getContext('2d');
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(drawing.current.x, drawing.current.y, (brush * work.current.width) / 2, 0, Math.PI * 2);
    ctx.fill();
    render();
  }
  function drawMove(e) {
    const last = drawing.current;
    if (!last) return;
    const { fx, fy } = pointIn(e);
    const x = fx * work.current.width;
    const y = fy * work.current.height;
    const ctx = work.current.getContext('2d');
    ctx.strokeStyle = color;
    ctx.lineWidth = brush * work.current.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    drawing.current = { x, y };
    render();
  }
  function drawUp() {
    drawing.current = null;
  }

  // ----- finish -----
  async function finish() {
    if (busy) return;
    setBusy(true);
    try {
      const base = filtered(work.current, filter, bright);
      const out = copyCanvas(base);
      drawTexts(out.getContext('2d'), out.width, texts);
      const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', 0.88));
      if (!blob) throw new Error('Could not save the picture');
      onDone(blob);
    } catch (e) {
      setBusy(false);
      if (onError) onError(e);
    }
  }

  if (!ready) {
    return (
      <div className="ed-bg" role="dialog" aria-modal="true" aria-label="Photo editor">
        <p className="ed-loading">Opening photo…</p>
      </div>
    );
  }

  return (
    <div className="ed-bg" role="dialog" aria-modal="true" aria-label="Photo editor">
      <div className="ed-top">
        <button className="icon-btn" onClick={onCancel} aria-label="Cancel"><I n="close" /></button>
        <div className="ed-top-mid">
          <button className="icon-btn" onClick={rotate} aria-label="Rotate" title="Rotate">⟳</button>
          <button className="icon-btn" onClick={flip} aria-label="Flip" title="Flip"></button>
          <button className="icon-btn" onClick={undo} aria-label="Undo" title="Undo"><I n="undo" /></button>
        </div>
        <button className="btn-primary ed-done" onClick={finish} disabled={busy}>
          {busy ? 'Saving…' : doneLabel}
        </button>
      </div>

      <div className="ed-stage">
        <div className="ed-wrap" ref={wrap}>
          <canvas
            ref={display}
            className={`ed-canvas ${tool === 'draw' ? 'drawing' : ''}`}
            onPointerDown={drawDown}
            onPointerMove={drawMove}
            onPointerUp={drawUp}
            onPointerCancel={drawUp}
          />
          {tool === 'crop' && (
            <div className="ed-crop-layer" onPointerMove={cropMove} onPointerUp={cropUp} onPointerCancel={cropUp}>
              <div
                className="ed-crop"
                style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
                onPointerDown={(e) => cropDown(e, 'move')}
              >
                {['nw', 'ne', 'sw', 'se'].map((c) => (
                  <i key={c} className={`ed-handle ${c}`} onPointerDown={(e) => cropDown(e, c)} />
                ))}
              </div>
            </div>
          )}
          {texts.map((t) => (
            <div
              key={t.id}
              className="ed-text"
              style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%`, color: t.color, fontSize: `${Math.max(10, t.size * dispW)}px` }}
              onPointerDown={(e) => textDown(e, t.id)}
              onPointerMove={textMove}
              onPointerUp={textUp}
              onPointerCancel={textUp}
            >
              {t.text}
              <button
                type="button"
                className="ed-text-x"
                aria-label="Remove text"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setTexts((list) => list.filter((x) => x.id !== t.id))}
              >
                <I n="close" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="ed-panel">
        {tool === 'crop' && (
          <div className="ed-row">
            {RATIOS.map(([id, label]) => (
              <button key={id} type="button" className={`ed-chip ${ratio === id ? 'on' : ''}`} onClick={() => resetCrop(id)}>
                {label}
              </button>
            ))}
            <button type="button" className="ed-chip apply" onClick={applyCrop}><I n="check" /> Crop</button>
          </div>
        )}
        {tool === 'draw' && (
          <>
            <div className="ed-row">
              {COLORS.map((c) => (
                <button key={c} type="button" aria-label={`Colour ${c}`} className={`ed-dot ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
              ))}
            </div>
            <div className="ed-row">
              <label className="ed-slider">Brush
                <input type="range" min="0.004" max="0.04" step="0.002" value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
              </label>
            </div>
          </>
        )}
        {tool === 'text' && (
          <>
            <div className="ed-row">
              <input
                className="ed-input"
                value={textInput}
                maxLength={80}
                placeholder="Type text, then tap Add"
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addText())}
              />
              <button type="button" className="ed-chip apply" onClick={addText}>Add</button>
            </div>
            <div className="ed-row">
              {COLORS.map((c) => (
                <button key={c} type="button" aria-label={`Colour ${c}`} className={`ed-dot ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
              ))}
              <label className="ed-slider">Size
                <input type="range" min="0.04" max="0.14" step="0.005" value={textSize} onChange={(e) => setTextSize(Number(e.target.value))} />
              </label>
            </div>
            <p className="ed-hint">Drag the text to move it. <I n="close" /> removes it.</p>
          </>
        )}
        {tool === 'filter' && (
          <>
            <div className="ed-row scroll">
              {FILTERS.map(([id, label]) => (
                <button key={id} type="button" className={`ed-chip ${filter === id ? 'on' : ''}`} onClick={() => setFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="ed-row">
              <label className="ed-slider">Brightness
                <input type="range" min="-40" max="40" step="1" value={bright} onChange={(e) => setBright(Number(e.target.value))} />
              </label>
            </div>
          </>
        )}
      </div>

      <div className="ed-tabs" role="tablist" aria-label="Edit tools">
        {[
          ['crop', '', 'Crop'],
          ['draw', '', 'Draw'],
          ['text', 'Aa', 'Text'],
          ['filter', '', 'Filters'],
        ].map(([id, icon, label]) => (
          <button key={id} role="tab" aria-selected={tool === id} className={tool === id ? 'on' : ''} onClick={() => pickTool(id)}>
            <span>{icon}</span>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
