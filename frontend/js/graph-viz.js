/**
 * graph-viz.js — vis.js graph animation engine for while-true demo
 *
 * Exposes window.GraphViz with:
 *   init(containerId, mode)       mode: 'react' | 'autoresearch'
 *   enterNode(name)
 *   exitNode(name)
 *   loopBack(from, to, iteration)
 *   reset()
 *   destroy()
 *
 * Assumes vis.js is already loaded by the host HTML page.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Constants
  // ------------------------------------------------------------------

  /** Map SSE event node names → vis.js node ids */
  var NAME_MAP = {
    reason:      'REASON',
    tool_call:   'TOOL_CALL',
    observe:     'OBSERVE',
    plan:        'PLAN',
    search:      'SEARCH',
    synthesize:  'SYNTHESIZE',
    evaluate:    'EVALUATE'
  };

  var IDLE_COLOR  = { background: '#1a2d45', border: '#1c2d46' };
  var IDLE_FONT   = { color: '#dce8f5' };
  var ACTIVE_COLOR = { background: '#22d3ee', border: '#22d3ee' };
  var ACTIVE_FONT  = { color: '#07090f' };
  var DONE_COLOR   = { background: '#10b981', border: '#10b981' };
  var DONE_FONT    = { color: '#07090f' };
  var MUTED_COLOR  = { background: '#0d1423', border: '#364d6d' };
  var MUTED_FONT   = { color: '#364d6d' };

  var DEFAULT_OPTIONS = {
    physics: false,
    interaction: { dragNodes: false, zoomView: false, dragView: false },
    nodes: {
      shape: 'box',
      color: {
        background: '#1a2d45',
        border: '#1c2d46',
        highlight: { background: '#22d3ee', border: '#22d3ee' }
      },
      font: { color: '#dce8f5', face: 'JetBrains Mono', size: 13 },
      borderWidth: 1,
      borderWidthSelected: 2,
      margin: 10
    },
    edges: {
      color: { color: '#1c2d46', highlight: '#22d3ee' },
      arrows: { to: { enabled: true, scaleFactor: 0.7 } },
      font: { color: '#6a7f9a', size: 11, face: 'DM Sans' },
      width: 1.5
    }
  };

  // ------------------------------------------------------------------
  // Graph definitions
  // ------------------------------------------------------------------

  function buildReactGraph() {
    var nodes = [
      { id: 'REASON',   label: 'REASON',   x: -200, y: 0   },
      { id: 'TOOL_CALL', label: 'TOOL CALL', x: 200,  y: 0   },
      { id: 'OBSERVE',  label: 'OBSERVE',  x: 200,  y: 150 },
      {
        id: 'END', label: 'END', x: 400, y: -100,
        color: { background: '#0d1423', border: '#364d6d', highlight: { background: '#0d1423', border: '#364d6d' } },
        font:  { color: '#364d6d', face: 'JetBrains Mono', size: 13 }
      }
    ];

    var edges = [
      { from: 'REASON',   to: 'TOOL_CALL', id: 'rt', label: 'has tool call' },
      {
        from: 'REASON', to: 'END', id: 're', label: 'task complete',
        dashes: true, color: { color: '#364d6d' }
      },
      { from: 'TOOL_CALL', to: 'OBSERVE', id: 'to' },
      {
        from: 'OBSERVE', to: 'REASON', id: 'or',
        dashes: true, color: { color: '#f59e0b' },
        smooth: { type: 'curvedCCW', roundness: 0.4 },
        label: 'loop back'
      }
    ];

    return { nodes: nodes, edges: edges };
  }

  function buildAutoresearchGraph() {
    var nodes = [
      { id: 'PLAN',       label: 'PLAN',       x: -450, y: 0   },
      { id: 'SEARCH',     label: 'SEARCH',     x: -150, y: 0   },
      { id: 'SYNTHESIZE', label: 'SYNTHESIZE', x: 150,  y: 0   },
      { id: 'EVALUATE',   label: 'EVALUATE',   x: 450,  y: 0   },
      {
        id: 'END', label: 'END', x: 650, y: -80,
        color: { background: '#0d1423', border: '#364d6d', highlight: { background: '#0d1423', border: '#364d6d' } },
        font:  { color: '#364d6d', face: 'JetBrains Mono', size: 13 }
      }
    ];

    var edges = [
      { from: 'PLAN',       to: 'SEARCH',     id: 'ps' },
      { from: 'SEARCH',     to: 'SYNTHESIZE', id: 'ss' },
      { from: 'SYNTHESIZE', to: 'EVALUATE',   id: 'se' },
      {
        from: 'EVALUATE', to: 'END', id: 'ee', label: 'complete',
        dashes: true, color: { color: '#364d6d' }
      },
      {
        from: 'EVALUATE', to: 'SEARCH', id: 'es',
        dashes: true, color: { color: '#f59e0b' },
        smooth: { type: 'curvedCCW', roundness: 0.5 },
        label: 'has gaps'
      }
    ];

    return { nodes: nodes, edges: edges };
  }

  // ------------------------------------------------------------------
  // Module state
  // ------------------------------------------------------------------

  var _network      = null;
  var _nodesDS      = null;
  var _edgesDS      = null;
  var _mode         = null;

  /** Original node labels keyed by node id, set at init time */
  var _origLabels   = {};

  /**
   * Original edge data snapshots keyed by edge id, set at init time.
   * Each value is an object with the fields we need to restore:
   *   { color, width, dashes }
   */
  var _origEdges    = {};

  /** Exit timers keyed by node id so we can clear pending resets */
  var _exitTimers   = {};

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Normalise an SSE event name or raw node id to the vis.js node id.
   * Accepts either a key from NAME_MAP (e.g. 'tool_call') or an already-
   * uppercase id (e.g. 'TOOL_CALL').
   */
  function resolveId(name) {
    if (!name) return null;
    var lower = String(name).toLowerCase().replace(/\s+/g, '_');
    if (NAME_MAP[lower]) return NAME_MAP[lower];
    // Fallback: try uppercase direct match
    var upper = String(name).toUpperCase().replace(/\s+/g, '_');
    return upper;
  }

  /** Deep-clone a plain object (one level of nesting is sufficient here) */
  function cloneEdgeFields(edge) {
    var snap = {};
    // color
    if (edge.color !== undefined) {
      snap.color = (typeof edge.color === 'object')
        ? JSON.parse(JSON.stringify(edge.color))
        : edge.color;
    } else {
      snap.color = undefined;
    }
    // width
    snap.width = (edge.width !== undefined) ? edge.width : undefined;
    // dashes
    snap.dashes = (edge.dashes !== undefined) ? edge.dashes : undefined;
    return snap;
  }

  /** Apply stored original edge fields back to the DataSet */
  function restoreEdge(edgeId) {
    var orig = _origEdges[edgeId];
    if (!orig || !_edgesDS) return;
    var update = { id: edgeId };
    if (orig.color !== undefined)  update.color  = orig.color;
    if (orig.width !== undefined)  update.width  = orig.width;
    if (orig.dashes !== undefined) update.dashes = orig.dashes;
    _edgesDS.update(update);
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  var GraphViz = {

    /**
     * Initialise (or re-initialise) the graph.
     * @param {string} containerId  DOM element id that vis.js attaches to
     * @param {string} mode         'react' | 'autoresearch'
     */
    init: function (containerId, mode) {
      // Tear down any existing network
      this.destroy();

      var container = document.getElementById(containerId);
      if (!container) {
        console.error('[GraphViz] Container not found: ' + containerId);
        return;
      }

      var graphData = (mode === 'autoresearch')
        ? buildAutoresearchGraph()
        : buildReactGraph();

      _nodesDS = new vis.DataSet(graphData.nodes);
      _edgesDS = new vis.DataSet(graphData.edges);

      // Snapshot original labels
      _origLabels = {};
      _nodesDS.forEach(function (n) {
        _origLabels[n.id] = n.label;
      });

      // Snapshot original edge styles
      _origEdges = {};
      _edgesDS.forEach(function (e) {
        _origEdges[e.id] = cloneEdgeFields(e);
      });

      _exitTimers = {};
      _mode = mode;

      _network = new vis.Network(
        container,
        { nodes: _nodesDS, edges: _edgesDS },
        DEFAULT_OPTIONS
      );
    },

    /**
     * Highlight a node as "currently executing".
     * @param {string} name  SSE event node name
     */
    enterNode: function (name) {
      if (!_nodesDS) return;
      var nodeId = resolveId(name);
      if (!nodeId) return;

      // Cancel any pending exit-reset timer for this node
      if (_exitTimers[nodeId]) {
        clearTimeout(_exitTimers[nodeId]);
        delete _exitTimers[nodeId];
      }

      _nodesDS.update({
        id:    nodeId,
        color: { background: ACTIVE_COLOR.background, border: ACTIVE_COLOR.border, highlight: { background: '#22d3ee', border: '#22d3ee' } },
        font:  { color: ACTIVE_FONT.color, face: 'JetBrains Mono', size: 13 }
      });
    },

    /**
     * Mark a node as completed, then fade it back to idle after 400ms.
     * @param {string} name  SSE event node name
     */
    exitNode: function (name) {
      if (!_nodesDS) return;
      var nodeId = resolveId(name);
      if (!nodeId) return;

      _nodesDS.update({
        id:    nodeId,
        color: { background: DONE_COLOR.background, border: DONE_COLOR.border, highlight: { background: '#22d3ee', border: '#22d3ee' } },
        font:  { color: DONE_FONT.color, face: 'JetBrains Mono', size: 13 }
      });

      // Reset to idle after 400ms
      _exitTimers[nodeId] = setTimeout(function () {
        delete _exitTimers[nodeId];
        if (!_nodesDS) return;
        _nodesDS.update({
          id:    nodeId,
          color: { background: IDLE_COLOR.background, border: IDLE_COLOR.border, highlight: { background: '#22d3ee', border: '#22d3ee' } },
          font:  { color: IDLE_FONT.color, face: 'JetBrains Mono', size: 13 }
        });
      }, 400);
    },

    /**
     * Flash the edge from→to and badge the destination node with ×iteration.
     * @param {string} from       SSE name of the source node
     * @param {string} to         SSE name of the destination node
     * @param {number} iteration  Loop counter to display on the destination
     */
    loopBack: function (from, to, iteration) {
      if (!_edgesDS || !_nodesDS) return;

      var fromId = resolveId(from);
      var toId   = resolveId(to);
      if (!fromId || !toId) return;

      // Find the edge connecting from → to
      var edgeId = null;
      _edgesDS.forEach(function (e) {
        if (e.from === fromId && e.to === toId) {
          edgeId = e.id;
        }
      });

      if (edgeId) {
        // Flash the edge
        _edgesDS.update({ id: edgeId, color: { color: '#f59e0b' }, width: 3 });

        setTimeout(function () {
          if (!_edgesDS) return;
          restoreEdge(edgeId);
        }, 600);
      }

      // Badge the destination node label with ×iteration
      var origLabel = _origLabels[toId] || toId;
      _nodesDS.update({ id: toId, label: origLabel + '\n×' + iteration });
    },

    /**
     * Reset all nodes and edges to their initial state.
     */
    reset: function () {
      if (!_nodesDS || !_edgesDS) return;

      // Clear all pending exit timers
      Object.keys(_exitTimers).forEach(function (nodeId) {
        clearTimeout(_exitTimers[nodeId]);
      });
      _exitTimers = {};

      // Reset nodes
      _nodesDS.forEach(function (n) {
        // END node keeps its muted style
        if (n.id === 'END') return;
        _nodesDS.update({
          id:    n.id,
          label: _origLabels[n.id] || n.label,
          color: { background: IDLE_COLOR.background, border: IDLE_COLOR.border, highlight: { background: '#22d3ee', border: '#22d3ee' } },
          font:  { color: IDLE_FONT.color, face: 'JetBrains Mono', size: 13 }
        });
      });

      // Reset edges
      _edgesDS.forEach(function (e) {
        restoreEdge(e.id);
      });
    },

    /**
     * Destroy the vis.js network and null out all references.
     */
    destroy: function () {
      // Clear any pending timers
      Object.keys(_exitTimers || {}).forEach(function (nodeId) {
        clearTimeout(_exitTimers[nodeId]);
      });
      _exitTimers = {};

      if (_network) {
        _network.destroy();
        _network = null;
      }
      _nodesDS  = null;
      _edgesDS  = null;
      _mode     = null;
      _origLabels = {};
      _origEdges  = {};
    }
  };

  // ------------------------------------------------------------------
  // Export
  // ------------------------------------------------------------------
  window.GraphViz = GraphViz;

}());
