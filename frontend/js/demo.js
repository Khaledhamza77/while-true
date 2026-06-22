/**
 * demo.js — SSE client and UI controller for the while(true) live demo page.
 *
 * Consumes:
 *   window.GraphViz  (graph-viz.js)
 *   window.marked    (marked CDN)
 *
 * Backend:
 *   POST http://localhost:8000/api/run   → { run_id }
 *   GET  http://localhost:8000/api/stream/{run_id}  → SSE
 */

'use strict';

const API_BASE = 'http://localhost:8000';

let currentMode   = 'react';
let currentSource = null;   // active EventSource
let currentToolLog = null;  // last opened tool log element

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function setGraphStatus(text) {
  const el = document.querySelector('.graph-status');
  if (el) el.textContent = text;
}

function reEnableInputs() {
  document.getElementById('run-btn').disabled   = false;
  document.getElementById('query-input').disabled = false;
}

// ---------------------------------------------------------------------------
// Tool log helpers
// ---------------------------------------------------------------------------

function openToolLog(tool, args) {
  const entry = document.createElement('div');
  entry.className = 'tool-log';

  const header = document.createElement('div');
  header.className = 'tool-log-header';

  const query = (args && args.query) ? args.query : '';
  header.innerHTML = '&#x1F50D; ' + escapeHtml(tool) + ': <code>' + escapeHtml(query) + '</code>';

  const body = document.createElement('div');
  body.className = 'tool-log-body';

  entry.appendChild(header);
  entry.appendChild(body);

  header.addEventListener('click', function () {
    entry.classList.toggle('open');
  });

  document.getElementById('tool-logs').appendChild(entry);
  currentToolLog = entry;
}

function closeToolLog(content) {
  if (!currentToolLog) return;
  const body = currentToolLog.querySelector('.tool-log-body');
  if (!body) return;
  const truncated = (content.length > 800)
    ? content.slice(0, 800) + '…'
    : content;
  body.textContent = truncated;
}

// ---------------------------------------------------------------------------
// Done / Error
// ---------------------------------------------------------------------------

function handleDone(result) {
  if (currentSource) {
    currentSource.close();
    currentSource = null;
  }

  const tokenStream = document.getElementById('token-stream');
  tokenStream.style.display = 'none';

  const finalAnswer = document.getElementById('final-answer');
  finalAnswer.style.display = 'block';
  finalAnswer.innerHTML = marked.parse(result);

  setGraphStatus('✓ Complete');
  reEnableInputs();
}

function handleError(message) {
  if (currentSource) {
    currentSource.close();
    currentSource = null;
  }

  const card = document.createElement('div');
  card.className = 'error-card';
  card.innerHTML = '✗ <span>' + escapeHtml(message) + '</span>';
  document.getElementById('output-panel').appendChild(card);

  setGraphStatus('✗ Error');
  reEnableInputs();
}

// ---------------------------------------------------------------------------
// SSE dispatcher
// ---------------------------------------------------------------------------

function dispatch(evt) {
  switch (evt.type) {
    case 'node_enter':
      GraphViz.enterNode(evt.node);
      setGraphStatus('● ' + evt.node + ' active');
      break;

    case 'node_exit':
      GraphViz.exitNode(evt.node);
      setGraphStatus(evt.node + ' done');
      break;

    case 'loop_back':
      GraphViz.loopBack(evt.from, evt.to, evt.iteration);
      setGraphStatus('↩ loop back ×' + evt.iteration);
      break;

    case 'token': {
      const stream = document.getElementById('token-stream');
      stream.appendChild(document.createTextNode(evt.content));
      // Auto-scroll the output panel
      const panel = document.getElementById('output-panel');
      panel.scrollTop = panel.scrollHeight;
      break;
    }

    case 'tool_call':
      openToolLog(evt.tool, evt.args);
      break;

    case 'tool_result':
      closeToolLog(evt.content);
      break;

    case 'done':
      handleDone(evt.result);
      break;

    case 'error':
      handleError(evt.message);
      break;

    default:
      // Unknown event — ignore
      break;
  }
}

// ---------------------------------------------------------------------------
// Main run function
// ---------------------------------------------------------------------------

async function runQuery(query) {
  // Close any existing stream
  if (currentSource) {
    currentSource.close();
    currentSource = null;
  }

  // Disable inputs
  document.getElementById('run-btn').disabled    = true;
  document.getElementById('query-input').disabled = true;

  // Clear output
  const tokenStream = document.getElementById('token-stream');
  tokenStream.textContent = '';
  tokenStream.style.display = '';

  document.getElementById('tool-logs').innerHTML = '';

  const finalAnswer = document.getElementById('final-answer');
  finalAnswer.style.display = 'none';

  GraphViz.reset();
  setGraphStatus('Starting…');

  // POST to start a run
  let runId;
  try {
    const response = await fetch(API_BASE + '/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: currentMode, query: query })
    });
    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }
    const data = await response.json();
    runId = data.run_id;
  } catch (err) {
    handleError('Failed to connect to backend');
    return;
  }

  // Open SSE stream
  currentSource = new EventSource(API_BASE + '/api/stream/' + runId);

  currentSource.onmessage = function (e) {
    let evt;
    try {
      evt = JSON.parse(e.data);
    } catch (parseErr) {
      console.warn('[demo] Failed to parse SSE event:', e.data);
      return;
    }
    dispatch(evt);
  };

  currentSource.onerror = function () {
    if (currentSource && currentSource.readyState === EventSource.CLOSED) {
      // Stream closed cleanly — just re-enable inputs
      reEnableInputs();
    } else {
      handleError('Connection lost');
      if (currentSource) {
        currentSource.close();
        currentSource = null;
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Mode toggle
// ---------------------------------------------------------------------------

function handleModeToggle(newMode) {
  if (currentSource) {
    currentSource.close();
    currentSource = null;
    reEnableInputs();
  }
  if (newMode === currentMode) return;
  currentMode = newMode;

  // Update active class
  document.querySelectorAll('.mode-option').forEach(function (opt) {
    opt.classList.toggle('active', opt.dataset.mode === newMode);
  });

  // Re-initialise graph
  GraphViz.destroy();
  GraphViz.init('graph-container', currentMode);

  // Update placeholder
  const placeholders = {
    react:        'Who is the current world chess champion?',
    autoresearch: 'What are the tradeoffs between RAG and fine-tuning?'
  };
  document.getElementById('query-input').placeholder = placeholders[currentMode] || '';

  GraphViz.reset();
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', function () {
  // Initialise graph
  GraphViz.init('graph-container', 'react');

  // Mode toggle listeners
  document.querySelectorAll('.mode-option').forEach(function (opt) {
    opt.addEventListener('click', function () {
      handleModeToggle(opt.dataset.mode);
    });
  });

  // Run button
  document.getElementById('run-btn').addEventListener('click', function () {
    const query = document.getElementById('query-input').value.trim();
    if (query) runQuery(query);
  });

  // Enter key on input
  document.getElementById('query-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      const query = e.target.value.trim();
      if (query) runQuery(query);
    }
  });
});
