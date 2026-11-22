function i0(n) {
  return n && n.__esModule && Object.prototype.hasOwnProperty.call(n, "default") ? n.default : n;
}
var Nc = { exports: {} }, va = {};
/**
 * @license React
 * react-jsx-runtime.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var Up;
function a0() {
  if (Up) return va;
  Up = 1;
  var n = Symbol.for("react.transitional.element"), a = Symbol.for("react.fragment");
  function u(r, c, h) {
    var f = null;
    if (h !== void 0 && (f = "" + h), c.key !== void 0 && (f = "" + c.key), "key" in c) {
      h = {};
      for (var d in c)
        d !== "key" && (h[d] = c[d]);
    } else h = c;
    return c = h.ref, {
      $$typeof: n,
      type: r,
      key: f,
      ref: c !== void 0 ? c : null,
      props: h
    };
  }
  return va.Fragment = a, va.jsx = u, va.jsxs = u, va;
}
var Lp;
function u0() {
  return Lp || (Lp = 1, Nc.exports = a0()), Nc.exports;
}
var Mt = u0(), Rc = { exports: {} }, Sa = {}, Mc = { exports: {} }, Uc = {};
/**
 * @license React
 * scheduler.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var Bp;
function r0() {
  return Bp || (Bp = 1, (function(n) {
    function a(O, I) {
      var et = O.length;
      O.push(I);
      t: for (; 0 < et; ) {
        var ht = et - 1 >>> 1, T = O[ht];
        if (0 < c(T, I))
          O[ht] = I, O[et] = T, et = ht;
        else break t;
      }
    }
    function u(O) {
      return O.length === 0 ? null : O[0];
    }
    function r(O) {
      if (O.length === 0) return null;
      var I = O[0], et = O.pop();
      if (et !== I) {
        O[0] = et;
        t: for (var ht = 0, T = O.length, _ = T >>> 1; ht < _; ) {
          var Y = 2 * (ht + 1) - 1, x = O[Y], $ = Y + 1, ot = O[$];
          if (0 > c(x, et))
            $ < T && 0 > c(ot, x) ? (O[ht] = ot, O[$] = et, ht = $) : (O[ht] = x, O[Y] = et, ht = Y);
          else if ($ < T && 0 > c(ot, et))
            O[ht] = ot, O[$] = et, ht = $;
          else break t;
        }
      }
      return I;
    }
    function c(O, I) {
      var et = O.sortIndex - I.sortIndex;
      return et !== 0 ? et : O.id - I.id;
    }
    if (n.unstable_now = void 0, typeof performance == "object" && typeof performance.now == "function") {
      var h = performance;
      n.unstable_now = function() {
        return h.now();
      };
    } else {
      var f = Date, d = f.now();
      n.unstable_now = function() {
        return f.now() - d;
      };
    }
    var m = [], p = [], y = 1, b = null, E = 3, v = !1, A = !1, w = !1, q = !1, z = typeof setTimeout == "function" ? setTimeout : null, X = typeof clearTimeout == "function" ? clearTimeout : null, U = typeof setImmediate < "u" ? setImmediate : null;
    function W(O) {
      for (var I = u(p); I !== null; ) {
        if (I.callback === null) r(p);
        else if (I.startTime <= O)
          r(p), I.sortIndex = I.expirationTime, a(m, I);
        else break;
        I = u(p);
      }
    }
    function it(O) {
      if (w = !1, W(O), !A)
        if (u(m) !== null)
          A = !0, H || (H = !0, nt());
        else {
          var I = u(p);
          I !== null && tt(it, I.startTime - O);
        }
    }
    var H = !1, J = -1, ct = 5, Ct = -1;
    function B() {
      return q ? !0 : !(n.unstable_now() - Ct < ct);
    }
    function F() {
      if (q = !1, H) {
        var O = n.unstable_now();
        Ct = O;
        var I = !0;
        try {
          t: {
            A = !1, w && (w = !1, X(J), J = -1), v = !0;
            var et = E;
            try {
              e: {
                for (W(O), b = u(m); b !== null && !(b.expirationTime > O && B()); ) {
                  var ht = b.callback;
                  if (typeof ht == "function") {
                    b.callback = null, E = b.priorityLevel;
                    var T = ht(
                      b.expirationTime <= O
                    );
                    if (O = n.unstable_now(), typeof T == "function") {
                      b.callback = T, W(O), I = !0;
                      break e;
                    }
                    b === u(m) && r(m), W(O);
                  } else r(m);
                  b = u(m);
                }
                if (b !== null) I = !0;
                else {
                  var _ = u(p);
                  _ !== null && tt(
                    it,
                    _.startTime - O
                  ), I = !1;
                }
              }
              break t;
            } finally {
              b = null, E = et, v = !1;
            }
            I = void 0;
          }
        } finally {
          I ? nt() : H = !1;
        }
      }
    }
    var nt;
    if (typeof U == "function")
      nt = function() {
        U(F);
      };
    else if (typeof MessageChannel < "u") {
      var Et = new MessageChannel(), P = Et.port2;
      Et.port1.onmessage = F, nt = function() {
        P.postMessage(null);
      };
    } else
      nt = function() {
        z(F, 0);
      };
    function tt(O, I) {
      J = z(function() {
        O(n.unstable_now());
      }, I);
    }
    n.unstable_IdlePriority = 5, n.unstable_ImmediatePriority = 1, n.unstable_LowPriority = 4, n.unstable_NormalPriority = 3, n.unstable_Profiling = null, n.unstable_UserBlockingPriority = 2, n.unstable_cancelCallback = function(O) {
      O.callback = null;
    }, n.unstable_forceFrameRate = function(O) {
      0 > O || 125 < O ? console.error(
        "forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"
      ) : ct = 0 < O ? Math.floor(1e3 / O) : 5;
    }, n.unstable_getCurrentPriorityLevel = function() {
      return E;
    }, n.unstable_next = function(O) {
      switch (E) {
        case 1:
        case 2:
        case 3:
          var I = 3;
          break;
        default:
          I = E;
      }
      var et = E;
      E = I;
      try {
        return O();
      } finally {
        E = et;
      }
    }, n.unstable_requestPaint = function() {
      q = !0;
    }, n.unstable_runWithPriority = function(O, I) {
      switch (O) {
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
          break;
        default:
          O = 3;
      }
      var et = E;
      E = O;
      try {
        return I();
      } finally {
        E = et;
      }
    }, n.unstable_scheduleCallback = function(O, I, et) {
      var ht = n.unstable_now();
      switch (typeof et == "object" && et !== null ? (et = et.delay, et = typeof et == "number" && 0 < et ? ht + et : ht) : et = ht, O) {
        case 1:
          var T = -1;
          break;
        case 2:
          T = 250;
          break;
        case 5:
          T = 1073741823;
          break;
        case 4:
          T = 1e4;
          break;
        default:
          T = 5e3;
      }
      return T = et + T, O = {
        id: y++,
        callback: I,
        priorityLevel: O,
        startTime: et,
        expirationTime: T,
        sortIndex: -1
      }, et > ht ? (O.sortIndex = et, a(p, O), u(m) === null && O === u(p) && (w ? (X(J), J = -1) : w = !0, tt(it, et - ht))) : (O.sortIndex = T, a(m, O), A || v || (A = !0, H || (H = !0, nt()))), O;
    }, n.unstable_shouldYield = B, n.unstable_wrapCallback = function(O) {
      var I = E;
      return function() {
        var et = E;
        E = I;
        try {
          return O.apply(this, arguments);
        } finally {
          E = et;
        }
      };
    };
  })(Uc)), Uc;
}
var Hp;
function o0() {
  return Hp || (Hp = 1, Mc.exports = r0()), Mc.exports;
}
var Lc = { exports: {} }, mt = {};
/**
 * @license React
 * react.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var jp;
function c0() {
  if (jp) return mt;
  jp = 1;
  var n = Symbol.for("react.transitional.element"), a = Symbol.for("react.portal"), u = Symbol.for("react.fragment"), r = Symbol.for("react.strict_mode"), c = Symbol.for("react.profiler"), h = Symbol.for("react.consumer"), f = Symbol.for("react.context"), d = Symbol.for("react.forward_ref"), m = Symbol.for("react.suspense"), p = Symbol.for("react.memo"), y = Symbol.for("react.lazy"), b = Symbol.for("react.activity"), E = Symbol.iterator;
  function v(_) {
    return _ === null || typeof _ != "object" ? null : (_ = E && _[E] || _["@@iterator"], typeof _ == "function" ? _ : null);
  }
  var A = {
    isMounted: function() {
      return !1;
    },
    enqueueForceUpdate: function() {
    },
    enqueueReplaceState: function() {
    },
    enqueueSetState: function() {
    }
  }, w = Object.assign, q = {};
  function z(_, Y, x) {
    this.props = _, this.context = Y, this.refs = q, this.updater = x || A;
  }
  z.prototype.isReactComponent = {}, z.prototype.setState = function(_, Y) {
    if (typeof _ != "object" && typeof _ != "function" && _ != null)
      throw Error(
        "takes an object of state variables to update or a function which returns an object of state variables."
      );
    this.updater.enqueueSetState(this, _, Y, "setState");
  }, z.prototype.forceUpdate = function(_) {
    this.updater.enqueueForceUpdate(this, _, "forceUpdate");
  };
  function X() {
  }
  X.prototype = z.prototype;
  function U(_, Y, x) {
    this.props = _, this.context = Y, this.refs = q, this.updater = x || A;
  }
  var W = U.prototype = new X();
  W.constructor = U, w(W, z.prototype), W.isPureReactComponent = !0;
  var it = Array.isArray;
  function H() {
  }
  var J = { H: null, A: null, T: null, S: null }, ct = Object.prototype.hasOwnProperty;
  function Ct(_, Y, x) {
    var $ = x.ref;
    return {
      $$typeof: n,
      type: _,
      key: Y,
      ref: $ !== void 0 ? $ : null,
      props: x
    };
  }
  function B(_, Y) {
    return Ct(_.type, Y, _.props);
  }
  function F(_) {
    return typeof _ == "object" && _ !== null && _.$$typeof === n;
  }
  function nt(_) {
    var Y = { "=": "=0", ":": "=2" };
    return "$" + _.replace(/[=:]/g, function(x) {
      return Y[x];
    });
  }
  var Et = /\/+/g;
  function P(_, Y) {
    return typeof _ == "object" && _ !== null && _.key != null ? nt("" + _.key) : Y.toString(36);
  }
  function tt(_) {
    switch (_.status) {
      case "fulfilled":
        return _.value;
      case "rejected":
        throw _.reason;
      default:
        switch (typeof _.status == "string" ? _.then(H, H) : (_.status = "pending", _.then(
          function(Y) {
            _.status === "pending" && (_.status = "fulfilled", _.value = Y);
          },
          function(Y) {
            _.status === "pending" && (_.status = "rejected", _.reason = Y);
          }
        )), _.status) {
          case "fulfilled":
            return _.value;
          case "rejected":
            throw _.reason;
        }
    }
    throw _;
  }
  function O(_, Y, x, $, ot) {
    var ut = typeof _;
    (ut === "undefined" || ut === "boolean") && (_ = null);
    var xt = !1;
    if (_ === null) xt = !0;
    else
      switch (ut) {
        case "bigint":
        case "string":
        case "number":
          xt = !0;
          break;
        case "object":
          switch (_.$$typeof) {
            case n:
            case a:
              xt = !0;
              break;
            case y:
              return xt = _._init, O(
                xt(_._payload),
                Y,
                x,
                $,
                ot
              );
          }
      }
    if (xt)
      return ot = ot(_), xt = $ === "" ? "." + P(_, 0) : $, it(ot) ? (x = "", xt != null && (x = xt.replace(Et, "$&/") + "/"), O(ot, Y, x, "", function(be) {
        return be;
      })) : ot != null && (F(ot) && (ot = B(
        ot,
        x + (ot.key == null || _ && _.key === ot.key ? "" : ("" + ot.key).replace(
          Et,
          "$&/"
        ) + "/") + xt
      )), Y.push(ot)), 1;
    xt = 0;
    var wt = $ === "" ? "." : $ + ":";
    if (it(_))
      for (var bt = 0; bt < _.length; bt++)
        $ = _[bt], ut = wt + P($, bt), xt += O(
          $,
          Y,
          x,
          ut,
          ot
        );
    else if (bt = v(_), typeof bt == "function")
      for (_ = bt.call(_), bt = 0; !($ = _.next()).done; )
        $ = $.value, ut = wt + P($, bt++), xt += O(
          $,
          Y,
          x,
          ut,
          ot
        );
    else if (ut === "object") {
      if (typeof _.then == "function")
        return O(
          tt(_),
          Y,
          x,
          $,
          ot
        );
      throw Y = String(_), Error(
        "Objects are not valid as a React child (found: " + (Y === "[object Object]" ? "object with keys {" + Object.keys(_).join(", ") + "}" : Y) + "). If you meant to render a collection of children, use an array instead."
      );
    }
    return xt;
  }
  function I(_, Y, x) {
    if (_ == null) return _;
    var $ = [], ot = 0;
    return O(_, $, "", "", function(ut) {
      return Y.call(x, ut, ot++);
    }), $;
  }
  function et(_) {
    if (_._status === -1) {
      var Y = _._result;
      Y = Y(), Y.then(
        function(x) {
          (_._status === 0 || _._status === -1) && (_._status = 1, _._result = x);
        },
        function(x) {
          (_._status === 0 || _._status === -1) && (_._status = 2, _._result = x);
        }
      ), _._status === -1 && (_._status = 0, _._result = Y);
    }
    if (_._status === 1) return _._result.default;
    throw _._result;
  }
  var ht = typeof reportError == "function" ? reportError : function(_) {
    if (typeof window == "object" && typeof window.ErrorEvent == "function") {
      var Y = new window.ErrorEvent("error", {
        bubbles: !0,
        cancelable: !0,
        message: typeof _ == "object" && _ !== null && typeof _.message == "string" ? String(_.message) : String(_),
        error: _
      });
      if (!window.dispatchEvent(Y)) return;
    } else if (typeof process == "object" && typeof process.emit == "function") {
      process.emit("uncaughtException", _);
      return;
    }
    console.error(_);
  }, T = {
    map: I,
    forEach: function(_, Y, x) {
      I(
        _,
        function() {
          Y.apply(this, arguments);
        },
        x
      );
    },
    count: function(_) {
      var Y = 0;
      return I(_, function() {
        Y++;
      }), Y;
    },
    toArray: function(_) {
      return I(_, function(Y) {
        return Y;
      }) || [];
    },
    only: function(_) {
      if (!F(_))
        throw Error(
          "React.Children.only expected to receive a single React element child."
        );
      return _;
    }
  };
  return mt.Activity = b, mt.Children = T, mt.Component = z, mt.Fragment = u, mt.Profiler = c, mt.PureComponent = U, mt.StrictMode = r, mt.Suspense = m, mt.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = J, mt.__COMPILER_RUNTIME = {
    __proto__: null,
    c: function(_) {
      return J.H.useMemoCache(_);
    }
  }, mt.cache = function(_) {
    return function() {
      return _.apply(null, arguments);
    };
  }, mt.cacheSignal = function() {
    return null;
  }, mt.cloneElement = function(_, Y, x) {
    if (_ == null)
      throw Error(
        "The argument must be a React element, but you passed " + _ + "."
      );
    var $ = w({}, _.props), ot = _.key;
    if (Y != null)
      for (ut in Y.key !== void 0 && (ot = "" + Y.key), Y)
        !ct.call(Y, ut) || ut === "key" || ut === "__self" || ut === "__source" || ut === "ref" && Y.ref === void 0 || ($[ut] = Y[ut]);
    var ut = arguments.length - 2;
    if (ut === 1) $.children = x;
    else if (1 < ut) {
      for (var xt = Array(ut), wt = 0; wt < ut; wt++)
        xt[wt] = arguments[wt + 2];
      $.children = xt;
    }
    return Ct(_.type, ot, $);
  }, mt.createContext = function(_) {
    return _ = {
      $$typeof: f,
      _currentValue: _,
      _currentValue2: _,
      _threadCount: 0,
      Provider: null,
      Consumer: null
    }, _.Provider = _, _.Consumer = {
      $$typeof: h,
      _context: _
    }, _;
  }, mt.createElement = function(_, Y, x) {
    var $, ot = {}, ut = null;
    if (Y != null)
      for ($ in Y.key !== void 0 && (ut = "" + Y.key), Y)
        ct.call(Y, $) && $ !== "key" && $ !== "__self" && $ !== "__source" && (ot[$] = Y[$]);
    var xt = arguments.length - 2;
    if (xt === 1) ot.children = x;
    else if (1 < xt) {
      for (var wt = Array(xt), bt = 0; bt < xt; bt++)
        wt[bt] = arguments[bt + 2];
      ot.children = wt;
    }
    if (_ && _.defaultProps)
      for ($ in xt = _.defaultProps, xt)
        ot[$] === void 0 && (ot[$] = xt[$]);
    return Ct(_, ut, ot);
  }, mt.createRef = function() {
    return { current: null };
  }, mt.forwardRef = function(_) {
    return { $$typeof: d, render: _ };
  }, mt.isValidElement = F, mt.lazy = function(_) {
    return {
      $$typeof: y,
      _payload: { _status: -1, _result: _ },
      _init: et
    };
  }, mt.memo = function(_, Y) {
    return {
      $$typeof: p,
      type: _,
      compare: Y === void 0 ? null : Y
    };
  }, mt.startTransition = function(_) {
    var Y = J.T, x = {};
    J.T = x;
    try {
      var $ = _(), ot = J.S;
      ot !== null && ot(x, $), typeof $ == "object" && $ !== null && typeof $.then == "function" && $.then(H, ht);
    } catch (ut) {
      ht(ut);
    } finally {
      Y !== null && x.types !== null && (Y.types = x.types), J.T = Y;
    }
  }, mt.unstable_useCacheRefresh = function() {
    return J.H.useCacheRefresh();
  }, mt.use = function(_) {
    return J.H.use(_);
  }, mt.useActionState = function(_, Y, x) {
    return J.H.useActionState(_, Y, x);
  }, mt.useCallback = function(_, Y) {
    return J.H.useCallback(_, Y);
  }, mt.useContext = function(_) {
    return J.H.useContext(_);
  }, mt.useDebugValue = function() {
  }, mt.useDeferredValue = function(_, Y) {
    return J.H.useDeferredValue(_, Y);
  }, mt.useEffect = function(_, Y) {
    return J.H.useEffect(_, Y);
  }, mt.useEffectEvent = function(_) {
    return J.H.useEffectEvent(_);
  }, mt.useId = function() {
    return J.H.useId();
  }, mt.useImperativeHandle = function(_, Y, x) {
    return J.H.useImperativeHandle(_, Y, x);
  }, mt.useInsertionEffect = function(_, Y) {
    return J.H.useInsertionEffect(_, Y);
  }, mt.useLayoutEffect = function(_, Y) {
    return J.H.useLayoutEffect(_, Y);
  }, mt.useMemo = function(_, Y) {
    return J.H.useMemo(_, Y);
  }, mt.useOptimistic = function(_, Y) {
    return J.H.useOptimistic(_, Y);
  }, mt.useReducer = function(_, Y, x) {
    return J.H.useReducer(_, Y, x);
  }, mt.useRef = function(_) {
    return J.H.useRef(_);
  }, mt.useState = function(_) {
    return J.H.useState(_);
  }, mt.useSyncExternalStore = function(_, Y, x) {
    return J.H.useSyncExternalStore(
      _,
      Y,
      x
    );
  }, mt.useTransition = function() {
    return J.H.useTransition();
  }, mt.version = "19.2.0", mt;
}
var qp;
function ys() {
  return qp || (qp = 1, Lc.exports = c0()), Lc.exports;
}
var Bc = { exports: {} }, Se = {};
/**
 * @license React
 * react-dom.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var Ip;
function s0() {
  if (Ip) return Se;
  Ip = 1;
  var n = ys();
  function a(m) {
    var p = "https://react.dev/errors/" + m;
    if (1 < arguments.length) {
      p += "?args[]=" + encodeURIComponent(arguments[1]);
      for (var y = 2; y < arguments.length; y++)
        p += "&args[]=" + encodeURIComponent(arguments[y]);
    }
    return "Minified React error #" + m + "; visit " + p + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
  }
  function u() {
  }
  var r = {
    d: {
      f: u,
      r: function() {
        throw Error(a(522));
      },
      D: u,
      C: u,
      L: u,
      m: u,
      X: u,
      S: u,
      M: u
    },
    p: 0,
    findDOMNode: null
  }, c = Symbol.for("react.portal");
  function h(m, p, y) {
    var b = 3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
    return {
      $$typeof: c,
      key: b == null ? null : "" + b,
      children: m,
      containerInfo: p,
      implementation: y
    };
  }
  var f = n.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  function d(m, p) {
    if (m === "font") return "";
    if (typeof p == "string")
      return p === "use-credentials" ? p : "";
  }
  return Se.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = r, Se.createPortal = function(m, p) {
    var y = 2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
    if (!p || p.nodeType !== 1 && p.nodeType !== 9 && p.nodeType !== 11)
      throw Error(a(299));
    return h(m, p, null, y);
  }, Se.flushSync = function(m) {
    var p = f.T, y = r.p;
    try {
      if (f.T = null, r.p = 2, m) return m();
    } finally {
      f.T = p, r.p = y, r.d.f();
    }
  }, Se.preconnect = function(m, p) {
    typeof m == "string" && (p ? (p = p.crossOrigin, p = typeof p == "string" ? p === "use-credentials" ? p : "" : void 0) : p = null, r.d.C(m, p));
  }, Se.prefetchDNS = function(m) {
    typeof m == "string" && r.d.D(m);
  }, Se.preinit = function(m, p) {
    if (typeof m == "string" && p && typeof p.as == "string") {
      var y = p.as, b = d(y, p.crossOrigin), E = typeof p.integrity == "string" ? p.integrity : void 0, v = typeof p.fetchPriority == "string" ? p.fetchPriority : void 0;
      y === "style" ? r.d.S(
        m,
        typeof p.precedence == "string" ? p.precedence : void 0,
        {
          crossOrigin: b,
          integrity: E,
          fetchPriority: v
        }
      ) : y === "script" && r.d.X(m, {
        crossOrigin: b,
        integrity: E,
        fetchPriority: v,
        nonce: typeof p.nonce == "string" ? p.nonce : void 0
      });
    }
  }, Se.preinitModule = function(m, p) {
    if (typeof m == "string")
      if (typeof p == "object" && p !== null) {
        if (p.as == null || p.as === "script") {
          var y = d(
            p.as,
            p.crossOrigin
          );
          r.d.M(m, {
            crossOrigin: y,
            integrity: typeof p.integrity == "string" ? p.integrity : void 0,
            nonce: typeof p.nonce == "string" ? p.nonce : void 0
          });
        }
      } else p == null && r.d.M(m);
  }, Se.preload = function(m, p) {
    if (typeof m == "string" && typeof p == "object" && p !== null && typeof p.as == "string") {
      var y = p.as, b = d(y, p.crossOrigin);
      r.d.L(m, y, {
        crossOrigin: b,
        integrity: typeof p.integrity == "string" ? p.integrity : void 0,
        nonce: typeof p.nonce == "string" ? p.nonce : void 0,
        type: typeof p.type == "string" ? p.type : void 0,
        fetchPriority: typeof p.fetchPriority == "string" ? p.fetchPriority : void 0,
        referrerPolicy: typeof p.referrerPolicy == "string" ? p.referrerPolicy : void 0,
        imageSrcSet: typeof p.imageSrcSet == "string" ? p.imageSrcSet : void 0,
        imageSizes: typeof p.imageSizes == "string" ? p.imageSizes : void 0,
        media: typeof p.media == "string" ? p.media : void 0
      });
    }
  }, Se.preloadModule = function(m, p) {
    if (typeof m == "string")
      if (p) {
        var y = d(p.as, p.crossOrigin);
        r.d.m(m, {
          as: typeof p.as == "string" && p.as !== "script" ? p.as : void 0,
          crossOrigin: y,
          integrity: typeof p.integrity == "string" ? p.integrity : void 0
        });
      } else r.d.m(m);
  }, Se.requestFormReset = function(m) {
    r.d.r(m);
  }, Se.unstable_batchedUpdates = function(m, p) {
    return m(p);
  }, Se.useFormState = function(m, p, y) {
    return f.H.useFormState(m, p, y);
  }, Se.useFormStatus = function() {
    return f.H.useHostTransitionStatus();
  }, Se.version = "19.2.0", Se;
}
var Vp;
function f0() {
  if (Vp) return Bc.exports;
  Vp = 1;
  function n() {
    if (!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function"))
      try {
        __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n);
      } catch (a) {
        console.error(a);
      }
  }
  return n(), Bc.exports = s0(), Bc.exports;
}
/**
 * @license React
 * react-dom-client.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var Yp;
function h0() {
  if (Yp) return Sa;
  Yp = 1;
  var n = o0(), a = ys(), u = f0();
  function r(t) {
    var e = "https://react.dev/errors/" + t;
    if (1 < arguments.length) {
      e += "?args[]=" + encodeURIComponent(arguments[1]);
      for (var l = 2; l < arguments.length; l++)
        e += "&args[]=" + encodeURIComponent(arguments[l]);
    }
    return "Minified React error #" + t + "; visit " + e + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
  }
  function c(t) {
    return !(!t || t.nodeType !== 1 && t.nodeType !== 9 && t.nodeType !== 11);
  }
  function h(t) {
    var e = t, l = t;
    if (t.alternate) for (; e.return; ) e = e.return;
    else {
      t = e;
      do
        e = t, (e.flags & 4098) !== 0 && (l = e.return), t = e.return;
      while (t);
    }
    return e.tag === 3 ? l : null;
  }
  function f(t) {
    if (t.tag === 13) {
      var e = t.memoizedState;
      if (e === null && (t = t.alternate, t !== null && (e = t.memoizedState)), e !== null) return e.dehydrated;
    }
    return null;
  }
  function d(t) {
    if (t.tag === 31) {
      var e = t.memoizedState;
      if (e === null && (t = t.alternate, t !== null && (e = t.memoizedState)), e !== null) return e.dehydrated;
    }
    return null;
  }
  function m(t) {
    if (h(t) !== t)
      throw Error(r(188));
  }
  function p(t) {
    var e = t.alternate;
    if (!e) {
      if (e = h(t), e === null) throw Error(r(188));
      return e !== t ? null : t;
    }
    for (var l = t, i = e; ; ) {
      var o = l.return;
      if (o === null) break;
      var s = o.alternate;
      if (s === null) {
        if (i = o.return, i !== null) {
          l = i;
          continue;
        }
        break;
      }
      if (o.child === s.child) {
        for (s = o.child; s; ) {
          if (s === l) return m(o), t;
          if (s === i) return m(o), e;
          s = s.sibling;
        }
        throw Error(r(188));
      }
      if (l.return !== i.return) l = o, i = s;
      else {
        for (var g = !1, S = o.child; S; ) {
          if (S === l) {
            g = !0, l = o, i = s;
            break;
          }
          if (S === i) {
            g = !0, i = o, l = s;
            break;
          }
          S = S.sibling;
        }
        if (!g) {
          for (S = s.child; S; ) {
            if (S === l) {
              g = !0, l = s, i = o;
              break;
            }
            if (S === i) {
              g = !0, i = s, l = o;
              break;
            }
            S = S.sibling;
          }
          if (!g) throw Error(r(189));
        }
      }
      if (l.alternate !== i) throw Error(r(190));
    }
    if (l.tag !== 3) throw Error(r(188));
    return l.stateNode.current === l ? t : e;
  }
  function y(t) {
    var e = t.tag;
    if (e === 5 || e === 26 || e === 27 || e === 6) return t;
    for (t = t.child; t !== null; ) {
      if (e = y(t), e !== null) return e;
      t = t.sibling;
    }
    return null;
  }
  var b = Object.assign, E = Symbol.for("react.element"), v = Symbol.for("react.transitional.element"), A = Symbol.for("react.portal"), w = Symbol.for("react.fragment"), q = Symbol.for("react.strict_mode"), z = Symbol.for("react.profiler"), X = Symbol.for("react.consumer"), U = Symbol.for("react.context"), W = Symbol.for("react.forward_ref"), it = Symbol.for("react.suspense"), H = Symbol.for("react.suspense_list"), J = Symbol.for("react.memo"), ct = Symbol.for("react.lazy"), Ct = Symbol.for("react.activity"), B = Symbol.for("react.memo_cache_sentinel"), F = Symbol.iterator;
  function nt(t) {
    return t === null || typeof t != "object" ? null : (t = F && t[F] || t["@@iterator"], typeof t == "function" ? t : null);
  }
  var Et = Symbol.for("react.client.reference");
  function P(t) {
    if (t == null) return null;
    if (typeof t == "function")
      return t.$$typeof === Et ? null : t.displayName || t.name || null;
    if (typeof t == "string") return t;
    switch (t) {
      case w:
        return "Fragment";
      case z:
        return "Profiler";
      case q:
        return "StrictMode";
      case it:
        return "Suspense";
      case H:
        return "SuspenseList";
      case Ct:
        return "Activity";
    }
    if (typeof t == "object")
      switch (t.$$typeof) {
        case A:
          return "Portal";
        case U:
          return t.displayName || "Context";
        case X:
          return (t._context.displayName || "Context") + ".Consumer";
        case W:
          var e = t.render;
          return t = t.displayName, t || (t = e.displayName || e.name || "", t = t !== "" ? "ForwardRef(" + t + ")" : "ForwardRef"), t;
        case J:
          return e = t.displayName || null, e !== null ? e : P(t.type) || "Memo";
        case ct:
          e = t._payload, t = t._init;
          try {
            return P(t(e));
          } catch {
          }
      }
    return null;
  }
  var tt = Array.isArray, O = a.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, I = u.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, et = {
    pending: !1,
    data: null,
    method: null,
    action: null
  }, ht = [], T = -1;
  function _(t) {
    return { current: t };
  }
  function Y(t) {
    0 > T || (t.current = ht[T], ht[T] = null, T--);
  }
  function x(t, e) {
    T++, ht[T] = t.current, t.current = e;
  }
  var $ = _(null), ot = _(null), ut = _(null), xt = _(null);
  function wt(t, e) {
    switch (x(ut, e), x(ot, t), x($, null), e.nodeType) {
      case 9:
      case 11:
        t = (t = e.documentElement) && (t = t.namespaceURI) ? ip(t) : 0;
        break;
      default:
        if (t = e.tagName, e = e.namespaceURI)
          e = ip(e), t = ap(e, t);
        else
          switch (t) {
            case "svg":
              t = 1;
              break;
            case "math":
              t = 2;
              break;
            default:
              t = 0;
          }
    }
    Y($), x($, t);
  }
  function bt() {
    Y($), Y(ot), Y(ut);
  }
  function be(t) {
    t.memoizedState !== null && x(xt, t);
    var e = $.current, l = ap(e, t.type);
    e !== l && (x(ot, t), x($, l));
  }
  function un(t) {
    ot.current === t && (Y($), Y(ot)), xt.current === t && (Y(xt), ma._currentValue = et);
  }
  var rn, pn;
  function Wt(t) {
    if (rn === void 0)
      try {
        throw Error();
      } catch (l) {
        var e = l.stack.trim().match(/\n( *(at )?)/);
        rn = e && e[1] || "", pn = -1 < l.stack.indexOf(`
    at`) ? " (<anonymous>)" : -1 < l.stack.indexOf("@") ? "@unknown:0:0" : "";
      }
    return `
` + rn + t + pn;
  }
  var Un = !1;
  function Pt(t, e) {
    if (!t || Un) return "";
    Un = !0;
    var l = Error.prepareStackTrace;
    Error.prepareStackTrace = void 0;
    try {
      var i = {
        DetermineComponentFrameRoot: function() {
          try {
            if (e) {
              var Q = function() {
                throw Error();
              };
              if (Object.defineProperty(Q.prototype, "props", {
                set: function() {
                  throw Error();
                }
              }), typeof Reflect == "object" && Reflect.construct) {
                try {
                  Reflect.construct(Q, []);
                } catch (L) {
                  var M = L;
                }
                Reflect.construct(t, [], Q);
              } else {
                try {
                  Q.call();
                } catch (L) {
                  M = L;
                }
                t.call(Q.prototype);
              }
            } else {
              try {
                throw Error();
              } catch (L) {
                M = L;
              }
              (Q = t()) && typeof Q.catch == "function" && Q.catch(function() {
              });
            }
          } catch (L) {
            if (L && M && typeof L.stack == "string")
              return [L.stack, M.stack];
          }
          return [null, null];
        }
      };
      i.DetermineComponentFrameRoot.displayName = "DetermineComponentFrameRoot";
      var o = Object.getOwnPropertyDescriptor(
        i.DetermineComponentFrameRoot,
        "name"
      );
      o && o.configurable && Object.defineProperty(
        i.DetermineComponentFrameRoot,
        "name",
        { value: "DetermineComponentFrameRoot" }
      );
      var s = i.DetermineComponentFrameRoot(), g = s[0], S = s[1];
      if (g && S) {
        var C = g.split(`
`), R = S.split(`
`);
        for (o = i = 0; i < C.length && !C[i].includes("DetermineComponentFrameRoot"); )
          i++;
        for (; o < R.length && !R[o].includes(
          "DetermineComponentFrameRoot"
        ); )
          o++;
        if (i === C.length || o === R.length)
          for (i = C.length - 1, o = R.length - 1; 1 <= i && 0 <= o && C[i] !== R[o]; )
            o--;
        for (; 1 <= i && 0 <= o; i--, o--)
          if (C[i] !== R[o]) {
            if (i !== 1 || o !== 1)
              do
                if (i--, o--, 0 > o || C[i] !== R[o]) {
                  var V = `
` + C[i].replace(" at new ", " at ");
                  return t.displayName && V.includes("<anonymous>") && (V = V.replace("<anonymous>", t.displayName)), V;
                }
              while (1 <= i && 0 <= o);
            break;
          }
      }
    } finally {
      Un = !1, Error.prepareStackTrace = l;
    }
    return (l = t ? t.displayName || t.name : "") ? Wt(l) : "";
  }
  function Ml(t, e) {
    switch (t.tag) {
      case 26:
      case 27:
      case 5:
        return Wt(t.type);
      case 16:
        return Wt("Lazy");
      case 13:
        return t.child !== e && e !== null ? Wt("Suspense Fallback") : Wt("Suspense");
      case 19:
        return Wt("SuspenseList");
      case 0:
      case 15:
        return Pt(t.type, !1);
      case 11:
        return Pt(t.type.render, !1);
      case 1:
        return Pt(t.type, !0);
      case 31:
        return Wt("Activity");
      default:
        return "";
    }
  }
  function Ci(t) {
    try {
      var e = "", l = null;
      do
        e += Ml(t, l), l = t, t = t.return;
      while (t);
      return e;
    } catch (i) {
      return `
Error generating stack: ` + i.message + `
` + i.stack;
    }
  }
  var _i = Object.prototype.hasOwnProperty, Ul = n.unstable_scheduleCallback, Ll = n.unstable_cancelCallback, gr = n.unstable_shouldYield, yr = n.unstable_requestPaint, Ee = n.unstable_now, br = n.unstable_getCurrentPriorityLevel, Ua = n.unstable_ImmediatePriority, j = n.unstable_UserBlockingPriority, K = n.unstable_NormalPriority, dt = n.unstable_LowPriority, gt = n.unstable_IdlePriority, ve = n.log, qt = n.unstable_setDisableYieldValue, te = null, Xt = null;
  function Te(t) {
    if (typeof ve == "function" && qt(t), Xt && typeof Xt.setStrictMode == "function")
      try {
        Xt.setStrictMode(te, t);
      } catch {
      }
  }
  var ue = Math.clz32 ? Math.clz32 : ki, cl = Math.log, La = Math.LN2;
  function ki(t) {
    return t >>>= 0, t === 0 ? 32 : 31 - (cl(t) / La | 0) | 0;
  }
  var oe = 256, Pe = 262144, Ae = 4194304;
  function sl(t) {
    var e = t & 42;
    if (e !== 0) return e;
    switch (t & -t) {
      case 1:
        return 1;
      case 2:
        return 2;
      case 4:
        return 4;
      case 8:
        return 8;
      case 16:
        return 16;
      case 32:
        return 32;
      case 64:
        return 64;
      case 128:
        return 128;
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
        return t & 261888;
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return t & 3932160;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        return t & 62914560;
      case 67108864:
        return 67108864;
      case 134217728:
        return 134217728;
      case 268435456:
        return 268435456;
      case 536870912:
        return 536870912;
      case 1073741824:
        return 0;
      default:
        return t;
    }
  }
  function Ba(t, e, l) {
    var i = t.pendingLanes;
    if (i === 0) return 0;
    var o = 0, s = t.suspendedLanes, g = t.pingedLanes;
    t = t.warmLanes;
    var S = i & 134217727;
    return S !== 0 ? (i = S & ~s, i !== 0 ? o = sl(i) : (g &= S, g !== 0 ? o = sl(g) : l || (l = S & ~t, l !== 0 && (o = sl(l))))) : (S = i & ~s, S !== 0 ? o = sl(S) : g !== 0 ? o = sl(g) : l || (l = i & ~t, l !== 0 && (o = sl(l)))), o === 0 ? 0 : e !== 0 && e !== o && (e & s) === 0 && (s = o & -o, l = e & -e, s >= l || s === 32 && (l & 4194048) !== 0) ? e : o;
  }
  function zi(t, e) {
    return (t.pendingLanes & ~(t.suspendedLanes & ~t.pingedLanes) & e) === 0;
  }
  function Qg(t, e) {
    switch (t) {
      case 1:
      case 2:
      case 4:
      case 8:
      case 64:
        return e + 250;
      case 16:
      case 32:
      case 128:
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return e + 5e3;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        return -1;
      case 67108864:
      case 134217728:
      case 268435456:
      case 536870912:
      case 1073741824:
        return -1;
      default:
        return -1;
    }
  }
  function Hs() {
    var t = Ae;
    return Ae <<= 1, (Ae & 62914560) === 0 && (Ae = 4194304), t;
  }
  function vr(t) {
    for (var e = [], l = 0; 31 > l; l++) e.push(t);
    return e;
  }
  function wi(t, e) {
    t.pendingLanes |= e, e !== 268435456 && (t.suspendedLanes = 0, t.pingedLanes = 0, t.warmLanes = 0);
  }
  function Xg(t, e, l, i, o, s) {
    var g = t.pendingLanes;
    t.pendingLanes = l, t.suspendedLanes = 0, t.pingedLanes = 0, t.warmLanes = 0, t.expiredLanes &= l, t.entangledLanes &= l, t.errorRecoveryDisabledLanes &= l, t.shellSuspendCounter = 0;
    var S = t.entanglements, C = t.expirationTimes, R = t.hiddenUpdates;
    for (l = g & ~l; 0 < l; ) {
      var V = 31 - ue(l), Q = 1 << V;
      S[V] = 0, C[V] = -1;
      var M = R[V];
      if (M !== null)
        for (R[V] = null, V = 0; V < M.length; V++) {
          var L = M[V];
          L !== null && (L.lane &= -536870913);
        }
      l &= ~Q;
    }
    i !== 0 && js(t, i, 0), s !== 0 && o === 0 && t.tag !== 0 && (t.suspendedLanes |= s & ~(g & ~e));
  }
  function js(t, e, l) {
    t.pendingLanes |= e, t.suspendedLanes &= ~e;
    var i = 31 - ue(e);
    t.entangledLanes |= e, t.entanglements[i] = t.entanglements[i] | 1073741824 | l & 261930;
  }
  function qs(t, e) {
    var l = t.entangledLanes |= e;
    for (t = t.entanglements; l; ) {
      var i = 31 - ue(l), o = 1 << i;
      o & e | t[i] & e && (t[i] |= e), l &= ~o;
    }
  }
  function Is(t, e) {
    var l = e & -e;
    return l = (l & 42) !== 0 ? 1 : Sr(l), (l & (t.suspendedLanes | e)) !== 0 ? 0 : l;
  }
  function Sr(t) {
    switch (t) {
      case 2:
        t = 1;
        break;
      case 8:
        t = 4;
        break;
      case 32:
        t = 16;
        break;
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        t = 128;
        break;
      case 268435456:
        t = 134217728;
        break;
      default:
        t = 0;
    }
    return t;
  }
  function Er(t) {
    return t &= -t, 2 < t ? 8 < t ? (t & 134217727) !== 0 ? 32 : 268435456 : 8 : 2;
  }
  function Vs() {
    var t = I.p;
    return t !== 0 ? t : (t = window.event, t === void 0 ? 32 : zp(t.type));
  }
  function Ys(t, e) {
    var l = I.p;
    try {
      return I.p = t, e();
    } finally {
      I.p = l;
    }
  }
  var Ln = Math.random().toString(36).slice(2), fe = "__reactFiber$" + Ln, Ce = "__reactProps$" + Ln, Bl = "__reactContainer$" + Ln, xr = "__reactEvents$" + Ln, Zg = "__reactListeners$" + Ln, Kg = "__reactHandles$" + Ln, Gs = "__reactResources$" + Ln, Di = "__reactMarker$" + Ln;
  function Tr(t) {
    delete t[fe], delete t[Ce], delete t[xr], delete t[Zg], delete t[Kg];
  }
  function Hl(t) {
    var e = t[fe];
    if (e) return e;
    for (var l = t.parentNode; l; ) {
      if (e = l[Bl] || l[fe]) {
        if (l = e.alternate, e.child !== null || l !== null && l.child !== null)
          for (t = hp(t); t !== null; ) {
            if (l = t[fe]) return l;
            t = hp(t);
          }
        return e;
      }
      t = l, l = t.parentNode;
    }
    return null;
  }
  function jl(t) {
    if (t = t[fe] || t[Bl]) {
      var e = t.tag;
      if (e === 5 || e === 6 || e === 13 || e === 31 || e === 26 || e === 27 || e === 3)
        return t;
    }
    return null;
  }
  function Oi(t) {
    var e = t.tag;
    if (e === 5 || e === 26 || e === 27 || e === 6) return t.stateNode;
    throw Error(r(33));
  }
  function ql(t) {
    var e = t[Gs];
    return e || (e = t[Gs] = { hoistableStyles: /* @__PURE__ */ new Map(), hoistableScripts: /* @__PURE__ */ new Map() }), e;
  }
  function ce(t) {
    t[Di] = !0;
  }
  var Qs = /* @__PURE__ */ new Set(), Xs = {};
  function fl(t, e) {
    Il(t, e), Il(t + "Capture", e);
  }
  function Il(t, e) {
    for (Xs[t] = e, t = 0; t < e.length; t++)
      Qs.add(e[t]);
  }
  var Jg = RegExp(
    "^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$"
  ), Zs = {}, Ks = {};
  function Fg(t) {
    return _i.call(Ks, t) ? !0 : _i.call(Zs, t) ? !1 : Jg.test(t) ? Ks[t] = !0 : (Zs[t] = !0, !1);
  }
  function Ha(t, e, l) {
    if (Fg(e))
      if (l === null) t.removeAttribute(e);
      else {
        switch (typeof l) {
          case "undefined":
          case "function":
          case "symbol":
            t.removeAttribute(e);
            return;
          case "boolean":
            var i = e.toLowerCase().slice(0, 5);
            if (i !== "data-" && i !== "aria-") {
              t.removeAttribute(e);
              return;
            }
        }
        t.setAttribute(e, "" + l);
      }
  }
  function ja(t, e, l) {
    if (l === null) t.removeAttribute(e);
    else {
      switch (typeof l) {
        case "undefined":
        case "function":
        case "symbol":
        case "boolean":
          t.removeAttribute(e);
          return;
      }
      t.setAttribute(e, "" + l);
    }
  }
  function mn(t, e, l, i) {
    if (i === null) t.removeAttribute(l);
    else {
      switch (typeof i) {
        case "undefined":
        case "function":
        case "symbol":
        case "boolean":
          t.removeAttribute(l);
          return;
      }
      t.setAttributeNS(e, l, "" + i);
    }
  }
  function Ve(t) {
    switch (typeof t) {
      case "bigint":
      case "boolean":
      case "number":
      case "string":
      case "undefined":
        return t;
      case "object":
        return t;
      default:
        return "";
    }
  }
  function Js(t) {
    var e = t.type;
    return (t = t.nodeName) && t.toLowerCase() === "input" && (e === "checkbox" || e === "radio");
  }
  function $g(t, e, l) {
    var i = Object.getOwnPropertyDescriptor(
      t.constructor.prototype,
      e
    );
    if (!t.hasOwnProperty(e) && typeof i < "u" && typeof i.get == "function" && typeof i.set == "function") {
      var o = i.get, s = i.set;
      return Object.defineProperty(t, e, {
        configurable: !0,
        get: function() {
          return o.call(this);
        },
        set: function(g) {
          l = "" + g, s.call(this, g);
        }
      }), Object.defineProperty(t, e, {
        enumerable: i.enumerable
      }), {
        getValue: function() {
          return l;
        },
        setValue: function(g) {
          l = "" + g;
        },
        stopTracking: function() {
          t._valueTracker = null, delete t[e];
        }
      };
    }
  }
  function Ar(t) {
    if (!t._valueTracker) {
      var e = Js(t) ? "checked" : "value";
      t._valueTracker = $g(
        t,
        e,
        "" + t[e]
      );
    }
  }
  function Fs(t) {
    if (!t) return !1;
    var e = t._valueTracker;
    if (!e) return !0;
    var l = e.getValue(), i = "";
    return t && (i = Js(t) ? t.checked ? "true" : "false" : t.value), t = i, t !== l ? (e.setValue(t), !0) : !1;
  }
  function qa(t) {
    if (t = t || (typeof document < "u" ? document : void 0), typeof t > "u") return null;
    try {
      return t.activeElement || t.body;
    } catch {
      return t.body;
    }
  }
  var Wg = /[\n"\\]/g;
  function Ye(t) {
    return t.replace(
      Wg,
      function(e) {
        return "\\" + e.charCodeAt(0).toString(16) + " ";
      }
    );
  }
  function Cr(t, e, l, i, o, s, g, S) {
    t.name = "", g != null && typeof g != "function" && typeof g != "symbol" && typeof g != "boolean" ? t.type = g : t.removeAttribute("type"), e != null ? g === "number" ? (e === 0 && t.value === "" || t.value != e) && (t.value = "" + Ve(e)) : t.value !== "" + Ve(e) && (t.value = "" + Ve(e)) : g !== "submit" && g !== "reset" || t.removeAttribute("value"), e != null ? _r(t, g, Ve(e)) : l != null ? _r(t, g, Ve(l)) : i != null && t.removeAttribute("value"), o == null && s != null && (t.defaultChecked = !!s), o != null && (t.checked = o && typeof o != "function" && typeof o != "symbol"), S != null && typeof S != "function" && typeof S != "symbol" && typeof S != "boolean" ? t.name = "" + Ve(S) : t.removeAttribute("name");
  }
  function $s(t, e, l, i, o, s, g, S) {
    if (s != null && typeof s != "function" && typeof s != "symbol" && typeof s != "boolean" && (t.type = s), e != null || l != null) {
      if (!(s !== "submit" && s !== "reset" || e != null)) {
        Ar(t);
        return;
      }
      l = l != null ? "" + Ve(l) : "", e = e != null ? "" + Ve(e) : l, S || e === t.value || (t.value = e), t.defaultValue = e;
    }
    i = i ?? o, i = typeof i != "function" && typeof i != "symbol" && !!i, t.checked = S ? t.checked : !!i, t.defaultChecked = !!i, g != null && typeof g != "function" && typeof g != "symbol" && typeof g != "boolean" && (t.name = g), Ar(t);
  }
  function _r(t, e, l) {
    e === "number" && qa(t.ownerDocument) === t || t.defaultValue === "" + l || (t.defaultValue = "" + l);
  }
  function Vl(t, e, l, i) {
    if (t = t.options, e) {
      e = {};
      for (var o = 0; o < l.length; o++)
        e["$" + l[o]] = !0;
      for (l = 0; l < t.length; l++)
        o = e.hasOwnProperty("$" + t[l].value), t[l].selected !== o && (t[l].selected = o), o && i && (t[l].defaultSelected = !0);
    } else {
      for (l = "" + Ve(l), e = null, o = 0; o < t.length; o++) {
        if (t[o].value === l) {
          t[o].selected = !0, i && (t[o].defaultSelected = !0);
          return;
        }
        e !== null || t[o].disabled || (e = t[o]);
      }
      e !== null && (e.selected = !0);
    }
  }
  function Ws(t, e, l) {
    if (e != null && (e = "" + Ve(e), e !== t.value && (t.value = e), l == null)) {
      t.defaultValue !== e && (t.defaultValue = e);
      return;
    }
    t.defaultValue = l != null ? "" + Ve(l) : "";
  }
  function Ps(t, e, l, i) {
    if (e == null) {
      if (i != null) {
        if (l != null) throw Error(r(92));
        if (tt(i)) {
          if (1 < i.length) throw Error(r(93));
          i = i[0];
        }
        l = i;
      }
      l == null && (l = ""), e = l;
    }
    l = Ve(e), t.defaultValue = l, i = t.textContent, i === l && i !== "" && i !== null && (t.value = i), Ar(t);
  }
  function Yl(t, e) {
    if (e) {
      var l = t.firstChild;
      if (l && l === t.lastChild && l.nodeType === 3) {
        l.nodeValue = e;
        return;
      }
    }
    t.textContent = e;
  }
  var Pg = new Set(
    "animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(
      " "
    )
  );
  function tf(t, e, l) {
    var i = e.indexOf("--") === 0;
    l == null || typeof l == "boolean" || l === "" ? i ? t.setProperty(e, "") : e === "float" ? t.cssFloat = "" : t[e] = "" : i ? t.setProperty(e, l) : typeof l != "number" || l === 0 || Pg.has(e) ? e === "float" ? t.cssFloat = l : t[e] = ("" + l).trim() : t[e] = l + "px";
  }
  function ef(t, e, l) {
    if (e != null && typeof e != "object")
      throw Error(r(62));
    if (t = t.style, l != null) {
      for (var i in l)
        !l.hasOwnProperty(i) || e != null && e.hasOwnProperty(i) || (i.indexOf("--") === 0 ? t.setProperty(i, "") : i === "float" ? t.cssFloat = "" : t[i] = "");
      for (var o in e)
        i = e[o], e.hasOwnProperty(o) && l[o] !== i && tf(t, o, i);
    } else
      for (var s in e)
        e.hasOwnProperty(s) && tf(t, s, e[s]);
  }
  function kr(t) {
    if (t.indexOf("-") === -1) return !1;
    switch (t) {
      case "annotation-xml":
      case "color-profile":
      case "font-face":
      case "font-face-src":
      case "font-face-uri":
      case "font-face-format":
      case "font-face-name":
      case "missing-glyph":
        return !1;
      default:
        return !0;
    }
  }
  var ty = /* @__PURE__ */ new Map([
    ["acceptCharset", "accept-charset"],
    ["htmlFor", "for"],
    ["httpEquiv", "http-equiv"],
    ["crossOrigin", "crossorigin"],
    ["accentHeight", "accent-height"],
    ["alignmentBaseline", "alignment-baseline"],
    ["arabicForm", "arabic-form"],
    ["baselineShift", "baseline-shift"],
    ["capHeight", "cap-height"],
    ["clipPath", "clip-path"],
    ["clipRule", "clip-rule"],
    ["colorInterpolation", "color-interpolation"],
    ["colorInterpolationFilters", "color-interpolation-filters"],
    ["colorProfile", "color-profile"],
    ["colorRendering", "color-rendering"],
    ["dominantBaseline", "dominant-baseline"],
    ["enableBackground", "enable-background"],
    ["fillOpacity", "fill-opacity"],
    ["fillRule", "fill-rule"],
    ["floodColor", "flood-color"],
    ["floodOpacity", "flood-opacity"],
    ["fontFamily", "font-family"],
    ["fontSize", "font-size"],
    ["fontSizeAdjust", "font-size-adjust"],
    ["fontStretch", "font-stretch"],
    ["fontStyle", "font-style"],
    ["fontVariant", "font-variant"],
    ["fontWeight", "font-weight"],
    ["glyphName", "glyph-name"],
    ["glyphOrientationHorizontal", "glyph-orientation-horizontal"],
    ["glyphOrientationVertical", "glyph-orientation-vertical"],
    ["horizAdvX", "horiz-adv-x"],
    ["horizOriginX", "horiz-origin-x"],
    ["imageRendering", "image-rendering"],
    ["letterSpacing", "letter-spacing"],
    ["lightingColor", "lighting-color"],
    ["markerEnd", "marker-end"],
    ["markerMid", "marker-mid"],
    ["markerStart", "marker-start"],
    ["overlinePosition", "overline-position"],
    ["overlineThickness", "overline-thickness"],
    ["paintOrder", "paint-order"],
    ["panose-1", "panose-1"],
    ["pointerEvents", "pointer-events"],
    ["renderingIntent", "rendering-intent"],
    ["shapeRendering", "shape-rendering"],
    ["stopColor", "stop-color"],
    ["stopOpacity", "stop-opacity"],
    ["strikethroughPosition", "strikethrough-position"],
    ["strikethroughThickness", "strikethrough-thickness"],
    ["strokeDasharray", "stroke-dasharray"],
    ["strokeDashoffset", "stroke-dashoffset"],
    ["strokeLinecap", "stroke-linecap"],
    ["strokeLinejoin", "stroke-linejoin"],
    ["strokeMiterlimit", "stroke-miterlimit"],
    ["strokeOpacity", "stroke-opacity"],
    ["strokeWidth", "stroke-width"],
    ["textAnchor", "text-anchor"],
    ["textDecoration", "text-decoration"],
    ["textRendering", "text-rendering"],
    ["transformOrigin", "transform-origin"],
    ["underlinePosition", "underline-position"],
    ["underlineThickness", "underline-thickness"],
    ["unicodeBidi", "unicode-bidi"],
    ["unicodeRange", "unicode-range"],
    ["unitsPerEm", "units-per-em"],
    ["vAlphabetic", "v-alphabetic"],
    ["vHanging", "v-hanging"],
    ["vIdeographic", "v-ideographic"],
    ["vMathematical", "v-mathematical"],
    ["vectorEffect", "vector-effect"],
    ["vertAdvY", "vert-adv-y"],
    ["vertOriginX", "vert-origin-x"],
    ["vertOriginY", "vert-origin-y"],
    ["wordSpacing", "word-spacing"],
    ["writingMode", "writing-mode"],
    ["xmlnsXlink", "xmlns:xlink"],
    ["xHeight", "x-height"]
  ]), ey = /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
  function Ia(t) {
    return ey.test("" + t) ? "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')" : t;
  }
  function gn() {
  }
  var zr = null;
  function wr(t) {
    return t = t.target || t.srcElement || window, t.correspondingUseElement && (t = t.correspondingUseElement), t.nodeType === 3 ? t.parentNode : t;
  }
  var Gl = null, Ql = null;
  function nf(t) {
    var e = jl(t);
    if (e && (t = e.stateNode)) {
      var l = t[Ce] || null;
      t: switch (t = e.stateNode, e.type) {
        case "input":
          if (Cr(
            t,
            l.value,
            l.defaultValue,
            l.defaultValue,
            l.checked,
            l.defaultChecked,
            l.type,
            l.name
          ), e = l.name, l.type === "radio" && e != null) {
            for (l = t; l.parentNode; ) l = l.parentNode;
            for (l = l.querySelectorAll(
              'input[name="' + Ye(
                "" + e
              ) + '"][type="radio"]'
            ), e = 0; e < l.length; e++) {
              var i = l[e];
              if (i !== t && i.form === t.form) {
                var o = i[Ce] || null;
                if (!o) throw Error(r(90));
                Cr(
                  i,
                  o.value,
                  o.defaultValue,
                  o.defaultValue,
                  o.checked,
                  o.defaultChecked,
                  o.type,
                  o.name
                );
              }
            }
            for (e = 0; e < l.length; e++)
              i = l[e], i.form === t.form && Fs(i);
          }
          break t;
        case "textarea":
          Ws(t, l.value, l.defaultValue);
          break t;
        case "select":
          e = l.value, e != null && Vl(t, !!l.multiple, e, !1);
      }
    }
  }
  var Dr = !1;
  function lf(t, e, l) {
    if (Dr) return t(e, l);
    Dr = !0;
    try {
      var i = t(e);
      return i;
    } finally {
      if (Dr = !1, (Gl !== null || Ql !== null) && (zu(), Gl && (e = Gl, t = Ql, Ql = Gl = null, nf(e), t)))
        for (e = 0; e < t.length; e++) nf(t[e]);
    }
  }
  function Ni(t, e) {
    var l = t.stateNode;
    if (l === null) return null;
    var i = l[Ce] || null;
    if (i === null) return null;
    l = i[e];
    t: switch (e) {
      case "onClick":
      case "onClickCapture":
      case "onDoubleClick":
      case "onDoubleClickCapture":
      case "onMouseDown":
      case "onMouseDownCapture":
      case "onMouseMove":
      case "onMouseMoveCapture":
      case "onMouseUp":
      case "onMouseUpCapture":
      case "onMouseEnter":
        (i = !i.disabled) || (t = t.type, i = !(t === "button" || t === "input" || t === "select" || t === "textarea")), t = !i;
        break t;
      default:
        t = !1;
    }
    if (t) return null;
    if (l && typeof l != "function")
      throw Error(
        r(231, e, typeof l)
      );
    return l;
  }
  var yn = !(typeof window > "u" || typeof window.document > "u" || typeof window.document.createElement > "u"), Or = !1;
  if (yn)
    try {
      var Ri = {};
      Object.defineProperty(Ri, "passive", {
        get: function() {
          Or = !0;
        }
      }), window.addEventListener("test", Ri, Ri), window.removeEventListener("test", Ri, Ri);
    } catch {
      Or = !1;
    }
  var Bn = null, Nr = null, Va = null;
  function af() {
    if (Va) return Va;
    var t, e = Nr, l = e.length, i, o = "value" in Bn ? Bn.value : Bn.textContent, s = o.length;
    for (t = 0; t < l && e[t] === o[t]; t++) ;
    var g = l - t;
    for (i = 1; i <= g && e[l - i] === o[s - i]; i++) ;
    return Va = o.slice(t, 1 < i ? 1 - i : void 0);
  }
  function Ya(t) {
    var e = t.keyCode;
    return "charCode" in t ? (t = t.charCode, t === 0 && e === 13 && (t = 13)) : t = e, t === 10 && (t = 13), 32 <= t || t === 13 ? t : 0;
  }
  function Ga() {
    return !0;
  }
  function uf() {
    return !1;
  }
  function _e(t) {
    function e(l, i, o, s, g) {
      this._reactName = l, this._targetInst = o, this.type = i, this.nativeEvent = s, this.target = g, this.currentTarget = null;
      for (var S in t)
        t.hasOwnProperty(S) && (l = t[S], this[S] = l ? l(s) : s[S]);
      return this.isDefaultPrevented = (s.defaultPrevented != null ? s.defaultPrevented : s.returnValue === !1) ? Ga : uf, this.isPropagationStopped = uf, this;
    }
    return b(e.prototype, {
      preventDefault: function() {
        this.defaultPrevented = !0;
        var l = this.nativeEvent;
        l && (l.preventDefault ? l.preventDefault() : typeof l.returnValue != "unknown" && (l.returnValue = !1), this.isDefaultPrevented = Ga);
      },
      stopPropagation: function() {
        var l = this.nativeEvent;
        l && (l.stopPropagation ? l.stopPropagation() : typeof l.cancelBubble != "unknown" && (l.cancelBubble = !0), this.isPropagationStopped = Ga);
      },
      persist: function() {
      },
      isPersistent: Ga
    }), e;
  }
  var hl = {
    eventPhase: 0,
    bubbles: 0,
    cancelable: 0,
    timeStamp: function(t) {
      return t.timeStamp || Date.now();
    },
    defaultPrevented: 0,
    isTrusted: 0
  }, Qa = _e(hl), Mi = b({}, hl, { view: 0, detail: 0 }), ny = _e(Mi), Rr, Mr, Ui, Xa = b({}, Mi, {
    screenX: 0,
    screenY: 0,
    clientX: 0,
    clientY: 0,
    pageX: 0,
    pageY: 0,
    ctrlKey: 0,
    shiftKey: 0,
    altKey: 0,
    metaKey: 0,
    getModifierState: Lr,
    button: 0,
    buttons: 0,
    relatedTarget: function(t) {
      return t.relatedTarget === void 0 ? t.fromElement === t.srcElement ? t.toElement : t.fromElement : t.relatedTarget;
    },
    movementX: function(t) {
      return "movementX" in t ? t.movementX : (t !== Ui && (Ui && t.type === "mousemove" ? (Rr = t.screenX - Ui.screenX, Mr = t.screenY - Ui.screenY) : Mr = Rr = 0, Ui = t), Rr);
    },
    movementY: function(t) {
      return "movementY" in t ? t.movementY : Mr;
    }
  }), rf = _e(Xa), ly = b({}, Xa, { dataTransfer: 0 }), iy = _e(ly), ay = b({}, Mi, { relatedTarget: 0 }), Ur = _e(ay), uy = b({}, hl, {
    animationName: 0,
    elapsedTime: 0,
    pseudoElement: 0
  }), ry = _e(uy), oy = b({}, hl, {
    clipboardData: function(t) {
      return "clipboardData" in t ? t.clipboardData : window.clipboardData;
    }
  }), cy = _e(oy), sy = b({}, hl, { data: 0 }), of = _e(sy), fy = {
    Esc: "Escape",
    Spacebar: " ",
    Left: "ArrowLeft",
    Up: "ArrowUp",
    Right: "ArrowRight",
    Down: "ArrowDown",
    Del: "Delete",
    Win: "OS",
    Menu: "ContextMenu",
    Apps: "ContextMenu",
    Scroll: "ScrollLock",
    MozPrintableKey: "Unidentified"
  }, hy = {
    8: "Backspace",
    9: "Tab",
    12: "Clear",
    13: "Enter",
    16: "Shift",
    17: "Control",
    18: "Alt",
    19: "Pause",
    20: "CapsLock",
    27: "Escape",
    32: " ",
    33: "PageUp",
    34: "PageDown",
    35: "End",
    36: "Home",
    37: "ArrowLeft",
    38: "ArrowUp",
    39: "ArrowRight",
    40: "ArrowDown",
    45: "Insert",
    46: "Delete",
    112: "F1",
    113: "F2",
    114: "F3",
    115: "F4",
    116: "F5",
    117: "F6",
    118: "F7",
    119: "F8",
    120: "F9",
    121: "F10",
    122: "F11",
    123: "F12",
    144: "NumLock",
    145: "ScrollLock",
    224: "Meta"
  }, dy = {
    Alt: "altKey",
    Control: "ctrlKey",
    Meta: "metaKey",
    Shift: "shiftKey"
  };
  function py(t) {
    var e = this.nativeEvent;
    return e.getModifierState ? e.getModifierState(t) : (t = dy[t]) ? !!e[t] : !1;
  }
  function Lr() {
    return py;
  }
  var my = b({}, Mi, {
    key: function(t) {
      if (t.key) {
        var e = fy[t.key] || t.key;
        if (e !== "Unidentified") return e;
      }
      return t.type === "keypress" ? (t = Ya(t), t === 13 ? "Enter" : String.fromCharCode(t)) : t.type === "keydown" || t.type === "keyup" ? hy[t.keyCode] || "Unidentified" : "";
    },
    code: 0,
    location: 0,
    ctrlKey: 0,
    shiftKey: 0,
    altKey: 0,
    metaKey: 0,
    repeat: 0,
    locale: 0,
    getModifierState: Lr,
    charCode: function(t) {
      return t.type === "keypress" ? Ya(t) : 0;
    },
    keyCode: function(t) {
      return t.type === "keydown" || t.type === "keyup" ? t.keyCode : 0;
    },
    which: function(t) {
      return t.type === "keypress" ? Ya(t) : t.type === "keydown" || t.type === "keyup" ? t.keyCode : 0;
    }
  }), gy = _e(my), yy = b({}, Xa, {
    pointerId: 0,
    width: 0,
    height: 0,
    pressure: 0,
    tangentialPressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: 0,
    isPrimary: 0
  }), cf = _e(yy), by = b({}, Mi, {
    touches: 0,
    targetTouches: 0,
    changedTouches: 0,
    altKey: 0,
    metaKey: 0,
    ctrlKey: 0,
    shiftKey: 0,
    getModifierState: Lr
  }), vy = _e(by), Sy = b({}, hl, {
    propertyName: 0,
    elapsedTime: 0,
    pseudoElement: 0
  }), Ey = _e(Sy), xy = b({}, Xa, {
    deltaX: function(t) {
      return "deltaX" in t ? t.deltaX : "wheelDeltaX" in t ? -t.wheelDeltaX : 0;
    },
    deltaY: function(t) {
      return "deltaY" in t ? t.deltaY : "wheelDeltaY" in t ? -t.wheelDeltaY : "wheelDelta" in t ? -t.wheelDelta : 0;
    },
    deltaZ: 0,
    deltaMode: 0
  }), Ty = _e(xy), Ay = b({}, hl, {
    newState: 0,
    oldState: 0
  }), Cy = _e(Ay), _y = [9, 13, 27, 32], Br = yn && "CompositionEvent" in window, Li = null;
  yn && "documentMode" in document && (Li = document.documentMode);
  var ky = yn && "TextEvent" in window && !Li, sf = yn && (!Br || Li && 8 < Li && 11 >= Li), ff = " ", hf = !1;
  function df(t, e) {
    switch (t) {
      case "keyup":
        return _y.indexOf(e.keyCode) !== -1;
      case "keydown":
        return e.keyCode !== 229;
      case "keypress":
      case "mousedown":
      case "focusout":
        return !0;
      default:
        return !1;
    }
  }
  function pf(t) {
    return t = t.detail, typeof t == "object" && "data" in t ? t.data : null;
  }
  var Xl = !1;
  function zy(t, e) {
    switch (t) {
      case "compositionend":
        return pf(e);
      case "keypress":
        return e.which !== 32 ? null : (hf = !0, ff);
      case "textInput":
        return t = e.data, t === ff && hf ? null : t;
      default:
        return null;
    }
  }
  function wy(t, e) {
    if (Xl)
      return t === "compositionend" || !Br && df(t, e) ? (t = af(), Va = Nr = Bn = null, Xl = !1, t) : null;
    switch (t) {
      case "paste":
        return null;
      case "keypress":
        if (!(e.ctrlKey || e.altKey || e.metaKey) || e.ctrlKey && e.altKey) {
          if (e.char && 1 < e.char.length)
            return e.char;
          if (e.which) return String.fromCharCode(e.which);
        }
        return null;
      case "compositionend":
        return sf && e.locale !== "ko" ? null : e.data;
      default:
        return null;
    }
  }
  var Dy = {
    color: !0,
    date: !0,
    datetime: !0,
    "datetime-local": !0,
    email: !0,
    month: !0,
    number: !0,
    password: !0,
    range: !0,
    search: !0,
    tel: !0,
    text: !0,
    time: !0,
    url: !0,
    week: !0
  };
  function mf(t) {
    var e = t && t.nodeName && t.nodeName.toLowerCase();
    return e === "input" ? !!Dy[t.type] : e === "textarea";
  }
  function gf(t, e, l, i) {
    Gl ? Ql ? Ql.push(i) : Ql = [i] : Gl = i, e = Uu(e, "onChange"), 0 < e.length && (l = new Qa(
      "onChange",
      "change",
      null,
      l,
      i
    ), t.push({ event: l, listeners: e }));
  }
  var Bi = null, Hi = null;
  function Oy(t) {
    Wd(t, 0);
  }
  function Za(t) {
    var e = Oi(t);
    if (Fs(e)) return t;
  }
  function yf(t, e) {
    if (t === "change") return e;
  }
  var bf = !1;
  if (yn) {
    var Hr;
    if (yn) {
      var jr = "oninput" in document;
      if (!jr) {
        var vf = document.createElement("div");
        vf.setAttribute("oninput", "return;"), jr = typeof vf.oninput == "function";
      }
      Hr = jr;
    } else Hr = !1;
    bf = Hr && (!document.documentMode || 9 < document.documentMode);
  }
  function Sf() {
    Bi && (Bi.detachEvent("onpropertychange", Ef), Hi = Bi = null);
  }
  function Ef(t) {
    if (t.propertyName === "value" && Za(Hi)) {
      var e = [];
      gf(
        e,
        Hi,
        t,
        wr(t)
      ), lf(Oy, e);
    }
  }
  function Ny(t, e, l) {
    t === "focusin" ? (Sf(), Bi = e, Hi = l, Bi.attachEvent("onpropertychange", Ef)) : t === "focusout" && Sf();
  }
  function Ry(t) {
    if (t === "selectionchange" || t === "keyup" || t === "keydown")
      return Za(Hi);
  }
  function My(t, e) {
    if (t === "click") return Za(e);
  }
  function Uy(t, e) {
    if (t === "input" || t === "change")
      return Za(e);
  }
  function Ly(t, e) {
    return t === e && (t !== 0 || 1 / t === 1 / e) || t !== t && e !== e;
  }
  var Me = typeof Object.is == "function" ? Object.is : Ly;
  function ji(t, e) {
    if (Me(t, e)) return !0;
    if (typeof t != "object" || t === null || typeof e != "object" || e === null)
      return !1;
    var l = Object.keys(t), i = Object.keys(e);
    if (l.length !== i.length) return !1;
    for (i = 0; i < l.length; i++) {
      var o = l[i];
      if (!_i.call(e, o) || !Me(t[o], e[o]))
        return !1;
    }
    return !0;
  }
  function xf(t) {
    for (; t && t.firstChild; ) t = t.firstChild;
    return t;
  }
  function Tf(t, e) {
    var l = xf(t);
    t = 0;
    for (var i; l; ) {
      if (l.nodeType === 3) {
        if (i = t + l.textContent.length, t <= e && i >= e)
          return { node: l, offset: e - t };
        t = i;
      }
      t: {
        for (; l; ) {
          if (l.nextSibling) {
            l = l.nextSibling;
            break t;
          }
          l = l.parentNode;
        }
        l = void 0;
      }
      l = xf(l);
    }
  }
  function Af(t, e) {
    return t && e ? t === e ? !0 : t && t.nodeType === 3 ? !1 : e && e.nodeType === 3 ? Af(t, e.parentNode) : "contains" in t ? t.contains(e) : t.compareDocumentPosition ? !!(t.compareDocumentPosition(e) & 16) : !1 : !1;
  }
  function Cf(t) {
    t = t != null && t.ownerDocument != null && t.ownerDocument.defaultView != null ? t.ownerDocument.defaultView : window;
    for (var e = qa(t.document); e instanceof t.HTMLIFrameElement; ) {
      try {
        var l = typeof e.contentWindow.location.href == "string";
      } catch {
        l = !1;
      }
      if (l) t = e.contentWindow;
      else break;
      e = qa(t.document);
    }
    return e;
  }
  function qr(t) {
    var e = t && t.nodeName && t.nodeName.toLowerCase();
    return e && (e === "input" && (t.type === "text" || t.type === "search" || t.type === "tel" || t.type === "url" || t.type === "password") || e === "textarea" || t.contentEditable === "true");
  }
  var By = yn && "documentMode" in document && 11 >= document.documentMode, Zl = null, Ir = null, qi = null, Vr = !1;
  function _f(t, e, l) {
    var i = l.window === l ? l.document : l.nodeType === 9 ? l : l.ownerDocument;
    Vr || Zl == null || Zl !== qa(i) || (i = Zl, "selectionStart" in i && qr(i) ? i = { start: i.selectionStart, end: i.selectionEnd } : (i = (i.ownerDocument && i.ownerDocument.defaultView || window).getSelection(), i = {
      anchorNode: i.anchorNode,
      anchorOffset: i.anchorOffset,
      focusNode: i.focusNode,
      focusOffset: i.focusOffset
    }), qi && ji(qi, i) || (qi = i, i = Uu(Ir, "onSelect"), 0 < i.length && (e = new Qa(
      "onSelect",
      "select",
      null,
      e,
      l
    ), t.push({ event: e, listeners: i }), e.target = Zl)));
  }
  function dl(t, e) {
    var l = {};
    return l[t.toLowerCase()] = e.toLowerCase(), l["Webkit" + t] = "webkit" + e, l["Moz" + t] = "moz" + e, l;
  }
  var Kl = {
    animationend: dl("Animation", "AnimationEnd"),
    animationiteration: dl("Animation", "AnimationIteration"),
    animationstart: dl("Animation", "AnimationStart"),
    transitionrun: dl("Transition", "TransitionRun"),
    transitionstart: dl("Transition", "TransitionStart"),
    transitioncancel: dl("Transition", "TransitionCancel"),
    transitionend: dl("Transition", "TransitionEnd")
  }, Yr = {}, kf = {};
  yn && (kf = document.createElement("div").style, "AnimationEvent" in window || (delete Kl.animationend.animation, delete Kl.animationiteration.animation, delete Kl.animationstart.animation), "TransitionEvent" in window || delete Kl.transitionend.transition);
  function pl(t) {
    if (Yr[t]) return Yr[t];
    if (!Kl[t]) return t;
    var e = Kl[t], l;
    for (l in e)
      if (e.hasOwnProperty(l) && l in kf)
        return Yr[t] = e[l];
    return t;
  }
  var zf = pl("animationend"), wf = pl("animationiteration"), Df = pl("animationstart"), Hy = pl("transitionrun"), jy = pl("transitionstart"), qy = pl("transitioncancel"), Of = pl("transitionend"), Nf = /* @__PURE__ */ new Map(), Gr = "abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(
    " "
  );
  Gr.push("scrollEnd");
  function tn(t, e) {
    Nf.set(t, e), fl(e, [t]);
  }
  var Ka = typeof reportError == "function" ? reportError : function(t) {
    if (typeof window == "object" && typeof window.ErrorEvent == "function") {
      var e = new window.ErrorEvent("error", {
        bubbles: !0,
        cancelable: !0,
        message: typeof t == "object" && t !== null && typeof t.message == "string" ? String(t.message) : String(t),
        error: t
      });
      if (!window.dispatchEvent(e)) return;
    } else if (typeof process == "object" && typeof process.emit == "function") {
      process.emit("uncaughtException", t);
      return;
    }
    console.error(t);
  }, Ge = [], Jl = 0, Qr = 0;
  function Ja() {
    for (var t = Jl, e = Qr = Jl = 0; e < t; ) {
      var l = Ge[e];
      Ge[e++] = null;
      var i = Ge[e];
      Ge[e++] = null;
      var o = Ge[e];
      Ge[e++] = null;
      var s = Ge[e];
      if (Ge[e++] = null, i !== null && o !== null) {
        var g = i.pending;
        g === null ? o.next = o : (o.next = g.next, g.next = o), i.pending = o;
      }
      s !== 0 && Rf(l, o, s);
    }
  }
  function Fa(t, e, l, i) {
    Ge[Jl++] = t, Ge[Jl++] = e, Ge[Jl++] = l, Ge[Jl++] = i, Qr |= i, t.lanes |= i, t = t.alternate, t !== null && (t.lanes |= i);
  }
  function Xr(t, e, l, i) {
    return Fa(t, e, l, i), $a(t);
  }
  function ml(t, e) {
    return Fa(t, null, null, e), $a(t);
  }
  function Rf(t, e, l) {
    t.lanes |= l;
    var i = t.alternate;
    i !== null && (i.lanes |= l);
    for (var o = !1, s = t.return; s !== null; )
      s.childLanes |= l, i = s.alternate, i !== null && (i.childLanes |= l), s.tag === 22 && (t = s.stateNode, t === null || t._visibility & 1 || (o = !0)), t = s, s = s.return;
    return t.tag === 3 ? (s = t.stateNode, o && e !== null && (o = 31 - ue(l), t = s.hiddenUpdates, i = t[o], i === null ? t[o] = [e] : i.push(e), e.lane = l | 536870912), s) : null;
  }
  function $a(t) {
    if (50 < oa)
      throw oa = 0, nc = null, Error(r(185));
    for (var e = t.return; e !== null; )
      t = e, e = t.return;
    return t.tag === 3 ? t.stateNode : null;
  }
  var Fl = {};
  function Iy(t, e, l, i) {
    this.tag = t, this.key = l, this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null, this.index = 0, this.refCleanup = this.ref = null, this.pendingProps = e, this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null, this.mode = i, this.subtreeFlags = this.flags = 0, this.deletions = null, this.childLanes = this.lanes = 0, this.alternate = null;
  }
  function Ue(t, e, l, i) {
    return new Iy(t, e, l, i);
  }
  function Zr(t) {
    return t = t.prototype, !(!t || !t.isReactComponent);
  }
  function bn(t, e) {
    var l = t.alternate;
    return l === null ? (l = Ue(
      t.tag,
      e,
      t.key,
      t.mode
    ), l.elementType = t.elementType, l.type = t.type, l.stateNode = t.stateNode, l.alternate = t, t.alternate = l) : (l.pendingProps = e, l.type = t.type, l.flags = 0, l.subtreeFlags = 0, l.deletions = null), l.flags = t.flags & 65011712, l.childLanes = t.childLanes, l.lanes = t.lanes, l.child = t.child, l.memoizedProps = t.memoizedProps, l.memoizedState = t.memoizedState, l.updateQueue = t.updateQueue, e = t.dependencies, l.dependencies = e === null ? null : { lanes: e.lanes, firstContext: e.firstContext }, l.sibling = t.sibling, l.index = t.index, l.ref = t.ref, l.refCleanup = t.refCleanup, l;
  }
  function Mf(t, e) {
    t.flags &= 65011714;
    var l = t.alternate;
    return l === null ? (t.childLanes = 0, t.lanes = e, t.child = null, t.subtreeFlags = 0, t.memoizedProps = null, t.memoizedState = null, t.updateQueue = null, t.dependencies = null, t.stateNode = null) : (t.childLanes = l.childLanes, t.lanes = l.lanes, t.child = l.child, t.subtreeFlags = 0, t.deletions = null, t.memoizedProps = l.memoizedProps, t.memoizedState = l.memoizedState, t.updateQueue = l.updateQueue, t.type = l.type, e = l.dependencies, t.dependencies = e === null ? null : {
      lanes: e.lanes,
      firstContext: e.firstContext
    }), t;
  }
  function Wa(t, e, l, i, o, s) {
    var g = 0;
    if (i = t, typeof t == "function") Zr(t) && (g = 1);
    else if (typeof t == "string")
      g = X1(
        t,
        l,
        $.current
      ) ? 26 : t === "html" || t === "head" || t === "body" ? 27 : 5;
    else
      t: switch (t) {
        case Ct:
          return t = Ue(31, l, e, o), t.elementType = Ct, t.lanes = s, t;
        case w:
          return gl(l.children, o, s, e);
        case q:
          g = 8, o |= 24;
          break;
        case z:
          return t = Ue(12, l, e, o | 2), t.elementType = z, t.lanes = s, t;
        case it:
          return t = Ue(13, l, e, o), t.elementType = it, t.lanes = s, t;
        case H:
          return t = Ue(19, l, e, o), t.elementType = H, t.lanes = s, t;
        default:
          if (typeof t == "object" && t !== null)
            switch (t.$$typeof) {
              case U:
                g = 10;
                break t;
              case X:
                g = 9;
                break t;
              case W:
                g = 11;
                break t;
              case J:
                g = 14;
                break t;
              case ct:
                g = 16, i = null;
                break t;
            }
          g = 29, l = Error(
            r(130, t === null ? "null" : typeof t, "")
          ), i = null;
      }
    return e = Ue(g, l, e, o), e.elementType = t, e.type = i, e.lanes = s, e;
  }
  function gl(t, e, l, i) {
    return t = Ue(7, t, i, e), t.lanes = l, t;
  }
  function Kr(t, e, l) {
    return t = Ue(6, t, null, e), t.lanes = l, t;
  }
  function Uf(t) {
    var e = Ue(18, null, null, 0);
    return e.stateNode = t, e;
  }
  function Jr(t, e, l) {
    return e = Ue(
      4,
      t.children !== null ? t.children : [],
      t.key,
      e
    ), e.lanes = l, e.stateNode = {
      containerInfo: t.containerInfo,
      pendingChildren: null,
      implementation: t.implementation
    }, e;
  }
  var Lf = /* @__PURE__ */ new WeakMap();
  function Qe(t, e) {
    if (typeof t == "object" && t !== null) {
      var l = Lf.get(t);
      return l !== void 0 ? l : (e = {
        value: t,
        source: e,
        stack: Ci(e)
      }, Lf.set(t, e), e);
    }
    return {
      value: t,
      source: e,
      stack: Ci(e)
    };
  }
  var $l = [], Wl = 0, Pa = null, Ii = 0, Xe = [], Ze = 0, Hn = null, on = 1, cn = "";
  function vn(t, e) {
    $l[Wl++] = Ii, $l[Wl++] = Pa, Pa = t, Ii = e;
  }
  function Bf(t, e, l) {
    Xe[Ze++] = on, Xe[Ze++] = cn, Xe[Ze++] = Hn, Hn = t;
    var i = on;
    t = cn;
    var o = 32 - ue(i) - 1;
    i &= ~(1 << o), l += 1;
    var s = 32 - ue(e) + o;
    if (30 < s) {
      var g = o - o % 5;
      s = (i & (1 << g) - 1).toString(32), i >>= g, o -= g, on = 1 << 32 - ue(e) + o | l << o | i, cn = s + t;
    } else
      on = 1 << s | l << o | i, cn = t;
  }
  function Fr(t) {
    t.return !== null && (vn(t, 1), Bf(t, 1, 0));
  }
  function $r(t) {
    for (; t === Pa; )
      Pa = $l[--Wl], $l[Wl] = null, Ii = $l[--Wl], $l[Wl] = null;
    for (; t === Hn; )
      Hn = Xe[--Ze], Xe[Ze] = null, cn = Xe[--Ze], Xe[Ze] = null, on = Xe[--Ze], Xe[Ze] = null;
  }
  function Hf(t, e) {
    Xe[Ze++] = on, Xe[Ze++] = cn, Xe[Ze++] = Hn, on = e.id, cn = e.overflow, Hn = t;
  }
  var he = null, Gt = null, zt = !1, jn = null, Ke = !1, Wr = Error(r(519));
  function qn(t) {
    var e = Error(
      r(
        418,
        1 < arguments.length && arguments[1] !== void 0 && arguments[1] ? "text" : "HTML",
        ""
      )
    );
    throw Vi(Qe(e, t)), Wr;
  }
  function jf(t) {
    var e = t.stateNode, l = t.type, i = t.memoizedProps;
    switch (e[fe] = t, e[Ce] = i, l) {
      case "dialog":
        At("cancel", e), At("close", e);
        break;
      case "iframe":
      case "object":
      case "embed":
        At("load", e);
        break;
      case "video":
      case "audio":
        for (l = 0; l < sa.length; l++)
          At(sa[l], e);
        break;
      case "source":
        At("error", e);
        break;
      case "img":
      case "image":
      case "link":
        At("error", e), At("load", e);
        break;
      case "details":
        At("toggle", e);
        break;
      case "input":
        At("invalid", e), $s(
          e,
          i.value,
          i.defaultValue,
          i.checked,
          i.defaultChecked,
          i.type,
          i.name,
          !0
        );
        break;
      case "select":
        At("invalid", e);
        break;
      case "textarea":
        At("invalid", e), Ps(e, i.value, i.defaultValue, i.children);
    }
    l = i.children, typeof l != "string" && typeof l != "number" && typeof l != "bigint" || e.textContent === "" + l || i.suppressHydrationWarning === !0 || np(e.textContent, l) ? (i.popover != null && (At("beforetoggle", e), At("toggle", e)), i.onScroll != null && At("scroll", e), i.onScrollEnd != null && At("scrollend", e), i.onClick != null && (e.onclick = gn), e = !0) : e = !1, e || qn(t, !0);
  }
  function qf(t) {
    for (he = t.return; he; )
      switch (he.tag) {
        case 5:
        case 31:
        case 13:
          Ke = !1;
          return;
        case 27:
        case 3:
          Ke = !0;
          return;
        default:
          he = he.return;
      }
  }
  function Pl(t) {
    if (t !== he) return !1;
    if (!zt) return qf(t), zt = !0, !1;
    var e = t.tag, l;
    if ((l = e !== 3 && e !== 27) && ((l = e === 5) && (l = t.type, l = !(l !== "form" && l !== "button") || yc(t.type, t.memoizedProps)), l = !l), l && Gt && qn(t), qf(t), e === 13) {
      if (t = t.memoizedState, t = t !== null ? t.dehydrated : null, !t) throw Error(r(317));
      Gt = fp(t);
    } else if (e === 31) {
      if (t = t.memoizedState, t = t !== null ? t.dehydrated : null, !t) throw Error(r(317));
      Gt = fp(t);
    } else
      e === 27 ? (e = Gt, tl(t.type) ? (t = xc, xc = null, Gt = t) : Gt = e) : Gt = he ? Fe(t.stateNode.nextSibling) : null;
    return !0;
  }
  function yl() {
    Gt = he = null, zt = !1;
  }
  function Pr() {
    var t = jn;
    return t !== null && (De === null ? De = t : De.push.apply(
      De,
      t
    ), jn = null), t;
  }
  function Vi(t) {
    jn === null ? jn = [t] : jn.push(t);
  }
  var to = _(null), bl = null, Sn = null;
  function In(t, e, l) {
    x(to, e._currentValue), e._currentValue = l;
  }
  function En(t) {
    t._currentValue = to.current, Y(to);
  }
  function eo(t, e, l) {
    for (; t !== null; ) {
      var i = t.alternate;
      if ((t.childLanes & e) !== e ? (t.childLanes |= e, i !== null && (i.childLanes |= e)) : i !== null && (i.childLanes & e) !== e && (i.childLanes |= e), t === l) break;
      t = t.return;
    }
  }
  function no(t, e, l, i) {
    var o = t.child;
    for (o !== null && (o.return = t); o !== null; ) {
      var s = o.dependencies;
      if (s !== null) {
        var g = o.child;
        s = s.firstContext;
        t: for (; s !== null; ) {
          var S = s;
          s = o;
          for (var C = 0; C < e.length; C++)
            if (S.context === e[C]) {
              s.lanes |= l, S = s.alternate, S !== null && (S.lanes |= l), eo(
                s.return,
                l,
                t
              ), i || (g = null);
              break t;
            }
          s = S.next;
        }
      } else if (o.tag === 18) {
        if (g = o.return, g === null) throw Error(r(341));
        g.lanes |= l, s = g.alternate, s !== null && (s.lanes |= l), eo(g, l, t), g = null;
      } else g = o.child;
      if (g !== null) g.return = o;
      else
        for (g = o; g !== null; ) {
          if (g === t) {
            g = null;
            break;
          }
          if (o = g.sibling, o !== null) {
            o.return = g.return, g = o;
            break;
          }
          g = g.return;
        }
      o = g;
    }
  }
  function ti(t, e, l, i) {
    t = null;
    for (var o = e, s = !1; o !== null; ) {
      if (!s) {
        if ((o.flags & 524288) !== 0) s = !0;
        else if ((o.flags & 262144) !== 0) break;
      }
      if (o.tag === 10) {
        var g = o.alternate;
        if (g === null) throw Error(r(387));
        if (g = g.memoizedProps, g !== null) {
          var S = o.type;
          Me(o.pendingProps.value, g.value) || (t !== null ? t.push(S) : t = [S]);
        }
      } else if (o === xt.current) {
        if (g = o.alternate, g === null) throw Error(r(387));
        g.memoizedState.memoizedState !== o.memoizedState.memoizedState && (t !== null ? t.push(ma) : t = [ma]);
      }
      o = o.return;
    }
    t !== null && no(
      e,
      t,
      l,
      i
    ), e.flags |= 262144;
  }
  function tu(t) {
    for (t = t.firstContext; t !== null; ) {
      if (!Me(
        t.context._currentValue,
        t.memoizedValue
      ))
        return !0;
      t = t.next;
    }
    return !1;
  }
  function vl(t) {
    bl = t, Sn = null, t = t.dependencies, t !== null && (t.firstContext = null);
  }
  function de(t) {
    return If(bl, t);
  }
  function eu(t, e) {
    return bl === null && vl(t), If(t, e);
  }
  function If(t, e) {
    var l = e._currentValue;
    if (e = { context: e, memoizedValue: l, next: null }, Sn === null) {
      if (t === null) throw Error(r(308));
      Sn = e, t.dependencies = { lanes: 0, firstContext: e }, t.flags |= 524288;
    } else Sn = Sn.next = e;
    return l;
  }
  var Vy = typeof AbortController < "u" ? AbortController : function() {
    var t = [], e = this.signal = {
      aborted: !1,
      addEventListener: function(l, i) {
        t.push(i);
      }
    };
    this.abort = function() {
      e.aborted = !0, t.forEach(function(l) {
        return l();
      });
    };
  }, Yy = n.unstable_scheduleCallback, Gy = n.unstable_NormalPriority, ee = {
    $$typeof: U,
    Consumer: null,
    Provider: null,
    _currentValue: null,
    _currentValue2: null,
    _threadCount: 0
  };
  function lo() {
    return {
      controller: new Vy(),
      data: /* @__PURE__ */ new Map(),
      refCount: 0
    };
  }
  function Yi(t) {
    t.refCount--, t.refCount === 0 && Yy(Gy, function() {
      t.controller.abort();
    });
  }
  var Gi = null, io = 0, ei = 0, ni = null;
  function Qy(t, e) {
    if (Gi === null) {
      var l = Gi = [];
      io = 0, ei = oc(), ni = {
        status: "pending",
        value: void 0,
        then: function(i) {
          l.push(i);
        }
      };
    }
    return io++, e.then(Vf, Vf), e;
  }
  function Vf() {
    if (--io === 0 && Gi !== null) {
      ni !== null && (ni.status = "fulfilled");
      var t = Gi;
      Gi = null, ei = 0, ni = null;
      for (var e = 0; e < t.length; e++) (0, t[e])();
    }
  }
  function Xy(t, e) {
    var l = [], i = {
      status: "pending",
      value: null,
      reason: null,
      then: function(o) {
        l.push(o);
      }
    };
    return t.then(
      function() {
        i.status = "fulfilled", i.value = e;
        for (var o = 0; o < l.length; o++) (0, l[o])(e);
      },
      function(o) {
        for (i.status = "rejected", i.reason = o, o = 0; o < l.length; o++)
          (0, l[o])(void 0);
      }
    ), i;
  }
  var Yf = O.S;
  O.S = function(t, e) {
    _d = Ee(), typeof e == "object" && e !== null && typeof e.then == "function" && Qy(t, e), Yf !== null && Yf(t, e);
  };
  var Sl = _(null);
  function ao() {
    var t = Sl.current;
    return t !== null ? t : It.pooledCache;
  }
  function nu(t, e) {
    e === null ? x(Sl, Sl.current) : x(Sl, e.pool);
  }
  function Gf() {
    var t = ao();
    return t === null ? null : { parent: ee._currentValue, pool: t };
  }
  var li = Error(r(460)), uo = Error(r(474)), lu = Error(r(542)), iu = { then: function() {
  } };
  function Qf(t) {
    return t = t.status, t === "fulfilled" || t === "rejected";
  }
  function Xf(t, e, l) {
    switch (l = t[l], l === void 0 ? t.push(e) : l !== e && (e.then(gn, gn), e = l), e.status) {
      case "fulfilled":
        return e.value;
      case "rejected":
        throw t = e.reason, Kf(t), t;
      default:
        if (typeof e.status == "string") e.then(gn, gn);
        else {
          if (t = It, t !== null && 100 < t.shellSuspendCounter)
            throw Error(r(482));
          t = e, t.status = "pending", t.then(
            function(i) {
              if (e.status === "pending") {
                var o = e;
                o.status = "fulfilled", o.value = i;
              }
            },
            function(i) {
              if (e.status === "pending") {
                var o = e;
                o.status = "rejected", o.reason = i;
              }
            }
          );
        }
        switch (e.status) {
          case "fulfilled":
            return e.value;
          case "rejected":
            throw t = e.reason, Kf(t), t;
        }
        throw xl = e, li;
    }
  }
  function El(t) {
    try {
      var e = t._init;
      return e(t._payload);
    } catch (l) {
      throw l !== null && typeof l == "object" && typeof l.then == "function" ? (xl = l, li) : l;
    }
  }
  var xl = null;
  function Zf() {
    if (xl === null) throw Error(r(459));
    var t = xl;
    return xl = null, t;
  }
  function Kf(t) {
    if (t === li || t === lu)
      throw Error(r(483));
  }
  var ii = null, Qi = 0;
  function au(t) {
    var e = Qi;
    return Qi += 1, ii === null && (ii = []), Xf(ii, t, e);
  }
  function Xi(t, e) {
    e = e.props.ref, t.ref = e !== void 0 ? e : null;
  }
  function uu(t, e) {
    throw e.$$typeof === E ? Error(r(525)) : (t = Object.prototype.toString.call(e), Error(
      r(
        31,
        t === "[object Object]" ? "object with keys {" + Object.keys(e).join(", ") + "}" : t
      )
    ));
  }
  function Jf(t) {
    function e(D, k) {
      if (t) {
        var N = D.deletions;
        N === null ? (D.deletions = [k], D.flags |= 16) : N.push(k);
      }
    }
    function l(D, k) {
      if (!t) return null;
      for (; k !== null; )
        e(D, k), k = k.sibling;
      return null;
    }
    function i(D) {
      for (var k = /* @__PURE__ */ new Map(); D !== null; )
        D.key !== null ? k.set(D.key, D) : k.set(D.index, D), D = D.sibling;
      return k;
    }
    function o(D, k) {
      return D = bn(D, k), D.index = 0, D.sibling = null, D;
    }
    function s(D, k, N) {
      return D.index = N, t ? (N = D.alternate, N !== null ? (N = N.index, N < k ? (D.flags |= 67108866, k) : N) : (D.flags |= 67108866, k)) : (D.flags |= 1048576, k);
    }
    function g(D) {
      return t && D.alternate === null && (D.flags |= 67108866), D;
    }
    function S(D, k, N, G) {
      return k === null || k.tag !== 6 ? (k = Kr(N, D.mode, G), k.return = D, k) : (k = o(k, N), k.return = D, k);
    }
    function C(D, k, N, G) {
      var rt = N.type;
      return rt === w ? V(
        D,
        k,
        N.props.children,
        G,
        N.key
      ) : k !== null && (k.elementType === rt || typeof rt == "object" && rt !== null && rt.$$typeof === ct && El(rt) === k.type) ? (k = o(k, N.props), Xi(k, N), k.return = D, k) : (k = Wa(
        N.type,
        N.key,
        N.props,
        null,
        D.mode,
        G
      ), Xi(k, N), k.return = D, k);
    }
    function R(D, k, N, G) {
      return k === null || k.tag !== 4 || k.stateNode.containerInfo !== N.containerInfo || k.stateNode.implementation !== N.implementation ? (k = Jr(N, D.mode, G), k.return = D, k) : (k = o(k, N.children || []), k.return = D, k);
    }
    function V(D, k, N, G, rt) {
      return k === null || k.tag !== 7 ? (k = gl(
        N,
        D.mode,
        G,
        rt
      ), k.return = D, k) : (k = o(k, N), k.return = D, k);
    }
    function Q(D, k, N) {
      if (typeof k == "string" && k !== "" || typeof k == "number" || typeof k == "bigint")
        return k = Kr(
          "" + k,
          D.mode,
          N
        ), k.return = D, k;
      if (typeof k == "object" && k !== null) {
        switch (k.$$typeof) {
          case v:
            return N = Wa(
              k.type,
              k.key,
              k.props,
              null,
              D.mode,
              N
            ), Xi(N, k), N.return = D, N;
          case A:
            return k = Jr(
              k,
              D.mode,
              N
            ), k.return = D, k;
          case ct:
            return k = El(k), Q(D, k, N);
        }
        if (tt(k) || nt(k))
          return k = gl(
            k,
            D.mode,
            N,
            null
          ), k.return = D, k;
        if (typeof k.then == "function")
          return Q(D, au(k), N);
        if (k.$$typeof === U)
          return Q(
            D,
            eu(D, k),
            N
          );
        uu(D, k);
      }
      return null;
    }
    function M(D, k, N, G) {
      var rt = k !== null ? k.key : null;
      if (typeof N == "string" && N !== "" || typeof N == "number" || typeof N == "bigint")
        return rt !== null ? null : S(D, k, "" + N, G);
      if (typeof N == "object" && N !== null) {
        switch (N.$$typeof) {
          case v:
            return N.key === rt ? C(D, k, N, G) : null;
          case A:
            return N.key === rt ? R(D, k, N, G) : null;
          case ct:
            return N = El(N), M(D, k, N, G);
        }
        if (tt(N) || nt(N))
          return rt !== null ? null : V(D, k, N, G, null);
        if (typeof N.then == "function")
          return M(
            D,
            k,
            au(N),
            G
          );
        if (N.$$typeof === U)
          return M(
            D,
            k,
            eu(D, N),
            G
          );
        uu(D, N);
      }
      return null;
    }
    function L(D, k, N, G, rt) {
      if (typeof G == "string" && G !== "" || typeof G == "number" || typeof G == "bigint")
        return D = D.get(N) || null, S(k, D, "" + G, rt);
      if (typeof G == "object" && G !== null) {
        switch (G.$$typeof) {
          case v:
            return D = D.get(
              G.key === null ? N : G.key
            ) || null, C(k, D, G, rt);
          case A:
            return D = D.get(
              G.key === null ? N : G.key
            ) || null, R(k, D, G, rt);
          case ct:
            return G = El(G), L(
              D,
              k,
              N,
              G,
              rt
            );
        }
        if (tt(G) || nt(G))
          return D = D.get(N) || null, V(k, D, G, rt, null);
        if (typeof G.then == "function")
          return L(
            D,
            k,
            N,
            au(G),
            rt
          );
        if (G.$$typeof === U)
          return L(
            D,
            k,
            N,
            eu(k, G),
            rt
          );
        uu(k, G);
      }
      return null;
    }
    function lt(D, k, N, G) {
      for (var rt = null, Dt = null, at = k, vt = k = 0, kt = null; at !== null && vt < N.length; vt++) {
        at.index > vt ? (kt = at, at = null) : kt = at.sibling;
        var Ot = M(
          D,
          at,
          N[vt],
          G
        );
        if (Ot === null) {
          at === null && (at = kt);
          break;
        }
        t && at && Ot.alternate === null && e(D, at), k = s(Ot, k, vt), Dt === null ? rt = Ot : Dt.sibling = Ot, Dt = Ot, at = kt;
      }
      if (vt === N.length)
        return l(D, at), zt && vn(D, vt), rt;
      if (at === null) {
        for (; vt < N.length; vt++)
          at = Q(D, N[vt], G), at !== null && (k = s(
            at,
            k,
            vt
          ), Dt === null ? rt = at : Dt.sibling = at, Dt = at);
        return zt && vn(D, vt), rt;
      }
      for (at = i(at); vt < N.length; vt++)
        kt = L(
          at,
          D,
          vt,
          N[vt],
          G
        ), kt !== null && (t && kt.alternate !== null && at.delete(
          kt.key === null ? vt : kt.key
        ), k = s(
          kt,
          k,
          vt
        ), Dt === null ? rt = kt : Dt.sibling = kt, Dt = kt);
      return t && at.forEach(function(al) {
        return e(D, al);
      }), zt && vn(D, vt), rt;
    }
    function st(D, k, N, G) {
      if (N == null) throw Error(r(151));
      for (var rt = null, Dt = null, at = k, vt = k = 0, kt = null, Ot = N.next(); at !== null && !Ot.done; vt++, Ot = N.next()) {
        at.index > vt ? (kt = at, at = null) : kt = at.sibling;
        var al = M(D, at, Ot.value, G);
        if (al === null) {
          at === null && (at = kt);
          break;
        }
        t && at && al.alternate === null && e(D, at), k = s(al, k, vt), Dt === null ? rt = al : Dt.sibling = al, Dt = al, at = kt;
      }
      if (Ot.done)
        return l(D, at), zt && vn(D, vt), rt;
      if (at === null) {
        for (; !Ot.done; vt++, Ot = N.next())
          Ot = Q(D, Ot.value, G), Ot !== null && (k = s(Ot, k, vt), Dt === null ? rt = Ot : Dt.sibling = Ot, Dt = Ot);
        return zt && vn(D, vt), rt;
      }
      for (at = i(at); !Ot.done; vt++, Ot = N.next())
        Ot = L(at, D, vt, Ot.value, G), Ot !== null && (t && Ot.alternate !== null && at.delete(Ot.key === null ? vt : Ot.key), k = s(Ot, k, vt), Dt === null ? rt = Ot : Dt.sibling = Ot, Dt = Ot);
      return t && at.forEach(function(l0) {
        return e(D, l0);
      }), zt && vn(D, vt), rt;
    }
    function jt(D, k, N, G) {
      if (typeof N == "object" && N !== null && N.type === w && N.key === null && (N = N.props.children), typeof N == "object" && N !== null) {
        switch (N.$$typeof) {
          case v:
            t: {
              for (var rt = N.key; k !== null; ) {
                if (k.key === rt) {
                  if (rt = N.type, rt === w) {
                    if (k.tag === 7) {
                      l(
                        D,
                        k.sibling
                      ), G = o(
                        k,
                        N.props.children
                      ), G.return = D, D = G;
                      break t;
                    }
                  } else if (k.elementType === rt || typeof rt == "object" && rt !== null && rt.$$typeof === ct && El(rt) === k.type) {
                    l(
                      D,
                      k.sibling
                    ), G = o(k, N.props), Xi(G, N), G.return = D, D = G;
                    break t;
                  }
                  l(D, k);
                  break;
                } else e(D, k);
                k = k.sibling;
              }
              N.type === w ? (G = gl(
                N.props.children,
                D.mode,
                G,
                N.key
              ), G.return = D, D = G) : (G = Wa(
                N.type,
                N.key,
                N.props,
                null,
                D.mode,
                G
              ), Xi(G, N), G.return = D, D = G);
            }
            return g(D);
          case A:
            t: {
              for (rt = N.key; k !== null; ) {
                if (k.key === rt)
                  if (k.tag === 4 && k.stateNode.containerInfo === N.containerInfo && k.stateNode.implementation === N.implementation) {
                    l(
                      D,
                      k.sibling
                    ), G = o(k, N.children || []), G.return = D, D = G;
                    break t;
                  } else {
                    l(D, k);
                    break;
                  }
                else e(D, k);
                k = k.sibling;
              }
              G = Jr(N, D.mode, G), G.return = D, D = G;
            }
            return g(D);
          case ct:
            return N = El(N), jt(
              D,
              k,
              N,
              G
            );
        }
        if (tt(N))
          return lt(
            D,
            k,
            N,
            G
          );
        if (nt(N)) {
          if (rt = nt(N), typeof rt != "function") throw Error(r(150));
          return N = rt.call(N), st(
            D,
            k,
            N,
            G
          );
        }
        if (typeof N.then == "function")
          return jt(
            D,
            k,
            au(N),
            G
          );
        if (N.$$typeof === U)
          return jt(
            D,
            k,
            eu(D, N),
            G
          );
        uu(D, N);
      }
      return typeof N == "string" && N !== "" || typeof N == "number" || typeof N == "bigint" ? (N = "" + N, k !== null && k.tag === 6 ? (l(D, k.sibling), G = o(k, N), G.return = D, D = G) : (l(D, k), G = Kr(N, D.mode, G), G.return = D, D = G), g(D)) : l(D, k);
    }
    return function(D, k, N, G) {
      try {
        Qi = 0;
        var rt = jt(
          D,
          k,
          N,
          G
        );
        return ii = null, rt;
      } catch (at) {
        if (at === li || at === lu) throw at;
        var Dt = Ue(29, at, null, D.mode);
        return Dt.lanes = G, Dt.return = D, Dt;
      } finally {
      }
    };
  }
  var Tl = Jf(!0), Ff = Jf(!1), Vn = !1;
  function ro(t) {
    t.updateQueue = {
      baseState: t.memoizedState,
      firstBaseUpdate: null,
      lastBaseUpdate: null,
      shared: { pending: null, lanes: 0, hiddenCallbacks: null },
      callbacks: null
    };
  }
  function oo(t, e) {
    t = t.updateQueue, e.updateQueue === t && (e.updateQueue = {
      baseState: t.baseState,
      firstBaseUpdate: t.firstBaseUpdate,
      lastBaseUpdate: t.lastBaseUpdate,
      shared: t.shared,
      callbacks: null
    });
  }
  function Yn(t) {
    return { lane: t, tag: 0, payload: null, callback: null, next: null };
  }
  function Gn(t, e, l) {
    var i = t.updateQueue;
    if (i === null) return null;
    if (i = i.shared, (Rt & 2) !== 0) {
      var o = i.pending;
      return o === null ? e.next = e : (e.next = o.next, o.next = e), i.pending = e, e = $a(t), Rf(t, null, l), e;
    }
    return Fa(t, i, e, l), $a(t);
  }
  function Zi(t, e, l) {
    if (e = e.updateQueue, e !== null && (e = e.shared, (l & 4194048) !== 0)) {
      var i = e.lanes;
      i &= t.pendingLanes, l |= i, e.lanes = l, qs(t, l);
    }
  }
  function co(t, e) {
    var l = t.updateQueue, i = t.alternate;
    if (i !== null && (i = i.updateQueue, l === i)) {
      var o = null, s = null;
      if (l = l.firstBaseUpdate, l !== null) {
        do {
          var g = {
            lane: l.lane,
            tag: l.tag,
            payload: l.payload,
            callback: null,
            next: null
          };
          s === null ? o = s = g : s = s.next = g, l = l.next;
        } while (l !== null);
        s === null ? o = s = e : s = s.next = e;
      } else o = s = e;
      l = {
        baseState: i.baseState,
        firstBaseUpdate: o,
        lastBaseUpdate: s,
        shared: i.shared,
        callbacks: i.callbacks
      }, t.updateQueue = l;
      return;
    }
    t = l.lastBaseUpdate, t === null ? l.firstBaseUpdate = e : t.next = e, l.lastBaseUpdate = e;
  }
  var so = !1;
  function Ki() {
    if (so) {
      var t = ni;
      if (t !== null) throw t;
    }
  }
  function Ji(t, e, l, i) {
    so = !1;
    var o = t.updateQueue;
    Vn = !1;
    var s = o.firstBaseUpdate, g = o.lastBaseUpdate, S = o.shared.pending;
    if (S !== null) {
      o.shared.pending = null;
      var C = S, R = C.next;
      C.next = null, g === null ? s = R : g.next = R, g = C;
      var V = t.alternate;
      V !== null && (V = V.updateQueue, S = V.lastBaseUpdate, S !== g && (S === null ? V.firstBaseUpdate = R : S.next = R, V.lastBaseUpdate = C));
    }
    if (s !== null) {
      var Q = o.baseState;
      g = 0, V = R = C = null, S = s;
      do {
        var M = S.lane & -536870913, L = M !== S.lane;
        if (L ? (_t & M) === M : (i & M) === M) {
          M !== 0 && M === ei && (so = !0), V !== null && (V = V.next = {
            lane: 0,
            tag: S.tag,
            payload: S.payload,
            callback: null,
            next: null
          });
          t: {
            var lt = t, st = S;
            M = e;
            var jt = l;
            switch (st.tag) {
              case 1:
                if (lt = st.payload, typeof lt == "function") {
                  Q = lt.call(jt, Q, M);
                  break t;
                }
                Q = lt;
                break t;
              case 3:
                lt.flags = lt.flags & -65537 | 128;
              case 0:
                if (lt = st.payload, M = typeof lt == "function" ? lt.call(jt, Q, M) : lt, M == null) break t;
                Q = b({}, Q, M);
                break t;
              case 2:
                Vn = !0;
            }
          }
          M = S.callback, M !== null && (t.flags |= 64, L && (t.flags |= 8192), L = o.callbacks, L === null ? o.callbacks = [M] : L.push(M));
        } else
          L = {
            lane: M,
            tag: S.tag,
            payload: S.payload,
            callback: S.callback,
            next: null
          }, V === null ? (R = V = L, C = Q) : V = V.next = L, g |= M;
        if (S = S.next, S === null) {
          if (S = o.shared.pending, S === null)
            break;
          L = S, S = L.next, L.next = null, o.lastBaseUpdate = L, o.shared.pending = null;
        }
      } while (!0);
      V === null && (C = Q), o.baseState = C, o.firstBaseUpdate = R, o.lastBaseUpdate = V, s === null && (o.shared.lanes = 0), Jn |= g, t.lanes = g, t.memoizedState = Q;
    }
  }
  function $f(t, e) {
    if (typeof t != "function")
      throw Error(r(191, t));
    t.call(e);
  }
  function Wf(t, e) {
    var l = t.callbacks;
    if (l !== null)
      for (t.callbacks = null, t = 0; t < l.length; t++)
        $f(l[t], e);
  }
  var ai = _(null), ru = _(0);
  function Pf(t, e) {
    t = Dn, x(ru, t), x(ai, e), Dn = t | e.baseLanes;
  }
  function fo() {
    x(ru, Dn), x(ai, ai.current);
  }
  function ho() {
    Dn = ru.current, Y(ai), Y(ru);
  }
  var Le = _(null), Je = null;
  function Qn(t) {
    var e = t.alternate;
    x(Ft, Ft.current & 1), x(Le, t), Je === null && (e === null || ai.current !== null || e.memoizedState !== null) && (Je = t);
  }
  function po(t) {
    x(Ft, Ft.current), x(Le, t), Je === null && (Je = t);
  }
  function th(t) {
    t.tag === 22 ? (x(Ft, Ft.current), x(Le, t), Je === null && (Je = t)) : Xn();
  }
  function Xn() {
    x(Ft, Ft.current), x(Le, Le.current);
  }
  function Be(t) {
    Y(Le), Je === t && (Je = null), Y(Ft);
  }
  var Ft = _(0);
  function ou(t) {
    for (var e = t; e !== null; ) {
      if (e.tag === 13) {
        var l = e.memoizedState;
        if (l !== null && (l = l.dehydrated, l === null || Sc(l) || Ec(l)))
          return e;
      } else if (e.tag === 19 && (e.memoizedProps.revealOrder === "forwards" || e.memoizedProps.revealOrder === "backwards" || e.memoizedProps.revealOrder === "unstable_legacy-backwards" || e.memoizedProps.revealOrder === "together")) {
        if ((e.flags & 128) !== 0) return e;
      } else if (e.child !== null) {
        e.child.return = e, e = e.child;
        continue;
      }
      if (e === t) break;
      for (; e.sibling === null; ) {
        if (e.return === null || e.return === t) return null;
        e = e.return;
      }
      e.sibling.return = e.return, e = e.sibling;
    }
    return null;
  }
  var xn = 0, yt = null, Bt = null, ne = null, cu = !1, ui = !1, Al = !1, su = 0, Fi = 0, ri = null, Zy = 0;
  function Kt() {
    throw Error(r(321));
  }
  function mo(t, e) {
    if (e === null) return !1;
    for (var l = 0; l < e.length && l < t.length; l++)
      if (!Me(t[l], e[l])) return !1;
    return !0;
  }
  function go(t, e, l, i, o, s) {
    return xn = s, yt = e, e.memoizedState = null, e.updateQueue = null, e.lanes = 0, O.H = t === null || t.memoizedState === null ? Bh : Oo, Al = !1, s = l(i, o), Al = !1, ui && (s = nh(
      e,
      l,
      i,
      o
    )), eh(t), s;
  }
  function eh(t) {
    O.H = Pi;
    var e = Bt !== null && Bt.next !== null;
    if (xn = 0, ne = Bt = yt = null, cu = !1, Fi = 0, ri = null, e) throw Error(r(300));
    t === null || le || (t = t.dependencies, t !== null && tu(t) && (le = !0));
  }
  function nh(t, e, l, i) {
    yt = t;
    var o = 0;
    do {
      if (ui && (ri = null), Fi = 0, ui = !1, 25 <= o) throw Error(r(301));
      if (o += 1, ne = Bt = null, t.updateQueue != null) {
        var s = t.updateQueue;
        s.lastEffect = null, s.events = null, s.stores = null, s.memoCache != null && (s.memoCache.index = 0);
      }
      O.H = Hh, s = e(l, i);
    } while (ui);
    return s;
  }
  function Ky() {
    var t = O.H, e = t.useState()[0];
    return e = typeof e.then == "function" ? $i(e) : e, t = t.useState()[0], (Bt !== null ? Bt.memoizedState : null) !== t && (yt.flags |= 1024), e;
  }
  function yo() {
    var t = su !== 0;
    return su = 0, t;
  }
  function bo(t, e, l) {
    e.updateQueue = t.updateQueue, e.flags &= -2053, t.lanes &= ~l;
  }
  function vo(t) {
    if (cu) {
      for (t = t.memoizedState; t !== null; ) {
        var e = t.queue;
        e !== null && (e.pending = null), t = t.next;
      }
      cu = !1;
    }
    xn = 0, ne = Bt = yt = null, ui = !1, Fi = su = 0, ri = null;
  }
  function xe() {
    var t = {
      memoizedState: null,
      baseState: null,
      baseQueue: null,
      queue: null,
      next: null
    };
    return ne === null ? yt.memoizedState = ne = t : ne = ne.next = t, ne;
  }
  function $t() {
    if (Bt === null) {
      var t = yt.alternate;
      t = t !== null ? t.memoizedState : null;
    } else t = Bt.next;
    var e = ne === null ? yt.memoizedState : ne.next;
    if (e !== null)
      ne = e, Bt = t;
    else {
      if (t === null)
        throw yt.alternate === null ? Error(r(467)) : Error(r(310));
      Bt = t, t = {
        memoizedState: Bt.memoizedState,
        baseState: Bt.baseState,
        baseQueue: Bt.baseQueue,
        queue: Bt.queue,
        next: null
      }, ne === null ? yt.memoizedState = ne = t : ne = ne.next = t;
    }
    return ne;
  }
  function fu() {
    return { lastEffect: null, events: null, stores: null, memoCache: null };
  }
  function $i(t) {
    var e = Fi;
    return Fi += 1, ri === null && (ri = []), t = Xf(ri, t, e), e = yt, (ne === null ? e.memoizedState : ne.next) === null && (e = e.alternate, O.H = e === null || e.memoizedState === null ? Bh : Oo), t;
  }
  function hu(t) {
    if (t !== null && typeof t == "object") {
      if (typeof t.then == "function") return $i(t);
      if (t.$$typeof === U) return de(t);
    }
    throw Error(r(438, String(t)));
  }
  function So(t) {
    var e = null, l = yt.updateQueue;
    if (l !== null && (e = l.memoCache), e == null) {
      var i = yt.alternate;
      i !== null && (i = i.updateQueue, i !== null && (i = i.memoCache, i != null && (e = {
        data: i.data.map(function(o) {
          return o.slice();
        }),
        index: 0
      })));
    }
    if (e == null && (e = { data: [], index: 0 }), l === null && (l = fu(), yt.updateQueue = l), l.memoCache = e, l = e.data[e.index], l === void 0)
      for (l = e.data[e.index] = Array(t), i = 0; i < t; i++)
        l[i] = B;
    return e.index++, l;
  }
  function Tn(t, e) {
    return typeof e == "function" ? e(t) : e;
  }
  function du(t) {
    var e = $t();
    return Eo(e, Bt, t);
  }
  function Eo(t, e, l) {
    var i = t.queue;
    if (i === null) throw Error(r(311));
    i.lastRenderedReducer = l;
    var o = t.baseQueue, s = i.pending;
    if (s !== null) {
      if (o !== null) {
        var g = o.next;
        o.next = s.next, s.next = g;
      }
      e.baseQueue = o = s, i.pending = null;
    }
    if (s = t.baseState, o === null) t.memoizedState = s;
    else {
      e = o.next;
      var S = g = null, C = null, R = e, V = !1;
      do {
        var Q = R.lane & -536870913;
        if (Q !== R.lane ? (_t & Q) === Q : (xn & Q) === Q) {
          var M = R.revertLane;
          if (M === 0)
            C !== null && (C = C.next = {
              lane: 0,
              revertLane: 0,
              gesture: null,
              action: R.action,
              hasEagerState: R.hasEagerState,
              eagerState: R.eagerState,
              next: null
            }), Q === ei && (V = !0);
          else if ((xn & M) === M) {
            R = R.next, M === ei && (V = !0);
            continue;
          } else
            Q = {
              lane: 0,
              revertLane: R.revertLane,
              gesture: null,
              action: R.action,
              hasEagerState: R.hasEagerState,
              eagerState: R.eagerState,
              next: null
            }, C === null ? (S = C = Q, g = s) : C = C.next = Q, yt.lanes |= M, Jn |= M;
          Q = R.action, Al && l(s, Q), s = R.hasEagerState ? R.eagerState : l(s, Q);
        } else
          M = {
            lane: Q,
            revertLane: R.revertLane,
            gesture: R.gesture,
            action: R.action,
            hasEagerState: R.hasEagerState,
            eagerState: R.eagerState,
            next: null
          }, C === null ? (S = C = M, g = s) : C = C.next = M, yt.lanes |= Q, Jn |= Q;
        R = R.next;
      } while (R !== null && R !== e);
      if (C === null ? g = s : C.next = S, !Me(s, t.memoizedState) && (le = !0, V && (l = ni, l !== null)))
        throw l;
      t.memoizedState = s, t.baseState = g, t.baseQueue = C, i.lastRenderedState = s;
    }
    return o === null && (i.lanes = 0), [t.memoizedState, i.dispatch];
  }
  function xo(t) {
    var e = $t(), l = e.queue;
    if (l === null) throw Error(r(311));
    l.lastRenderedReducer = t;
    var i = l.dispatch, o = l.pending, s = e.memoizedState;
    if (o !== null) {
      l.pending = null;
      var g = o = o.next;
      do
        s = t(s, g.action), g = g.next;
      while (g !== o);
      Me(s, e.memoizedState) || (le = !0), e.memoizedState = s, e.baseQueue === null && (e.baseState = s), l.lastRenderedState = s;
    }
    return [s, i];
  }
  function lh(t, e, l) {
    var i = yt, o = $t(), s = zt;
    if (s) {
      if (l === void 0) throw Error(r(407));
      l = l();
    } else l = e();
    var g = !Me(
      (Bt || o).memoizedState,
      l
    );
    if (g && (o.memoizedState = l, le = !0), o = o.queue, Co(uh.bind(null, i, o, t), [
      t
    ]), o.getSnapshot !== e || g || ne !== null && ne.memoizedState.tag & 1) {
      if (i.flags |= 2048, oi(
        9,
        { destroy: void 0 },
        ah.bind(
          null,
          i,
          o,
          l,
          e
        ),
        null
      ), It === null) throw Error(r(349));
      s || (xn & 127) !== 0 || ih(i, e, l);
    }
    return l;
  }
  function ih(t, e, l) {
    t.flags |= 16384, t = { getSnapshot: e, value: l }, e = yt.updateQueue, e === null ? (e = fu(), yt.updateQueue = e, e.stores = [t]) : (l = e.stores, l === null ? e.stores = [t] : l.push(t));
  }
  function ah(t, e, l, i) {
    e.value = l, e.getSnapshot = i, rh(e) && oh(t);
  }
  function uh(t, e, l) {
    return l(function() {
      rh(e) && oh(t);
    });
  }
  function rh(t) {
    var e = t.getSnapshot;
    t = t.value;
    try {
      var l = e();
      return !Me(t, l);
    } catch {
      return !0;
    }
  }
  function oh(t) {
    var e = ml(t, 2);
    e !== null && Oe(e, t, 2);
  }
  function To(t) {
    var e = xe();
    if (typeof t == "function") {
      var l = t;
      if (t = l(), Al) {
        Te(!0);
        try {
          l();
        } finally {
          Te(!1);
        }
      }
    }
    return e.memoizedState = e.baseState = t, e.queue = {
      pending: null,
      lanes: 0,
      dispatch: null,
      lastRenderedReducer: Tn,
      lastRenderedState: t
    }, e;
  }
  function ch(t, e, l, i) {
    return t.baseState = l, Eo(
      t,
      Bt,
      typeof i == "function" ? i : Tn
    );
  }
  function Jy(t, e, l, i, o) {
    if (gu(t)) throw Error(r(485));
    if (t = e.action, t !== null) {
      var s = {
        payload: o,
        action: t,
        next: null,
        isTransition: !0,
        status: "pending",
        value: null,
        reason: null,
        listeners: [],
        then: function(g) {
          s.listeners.push(g);
        }
      };
      O.T !== null ? l(!0) : s.isTransition = !1, i(s), l = e.pending, l === null ? (s.next = e.pending = s, sh(e, s)) : (s.next = l.next, e.pending = l.next = s);
    }
  }
  function sh(t, e) {
    var l = e.action, i = e.payload, o = t.state;
    if (e.isTransition) {
      var s = O.T, g = {};
      O.T = g;
      try {
        var S = l(o, i), C = O.S;
        C !== null && C(g, S), fh(t, e, S);
      } catch (R) {
        Ao(t, e, R);
      } finally {
        s !== null && g.types !== null && (s.types = g.types), O.T = s;
      }
    } else
      try {
        s = l(o, i), fh(t, e, s);
      } catch (R) {
        Ao(t, e, R);
      }
  }
  function fh(t, e, l) {
    l !== null && typeof l == "object" && typeof l.then == "function" ? l.then(
      function(i) {
        hh(t, e, i);
      },
      function(i) {
        return Ao(t, e, i);
      }
    ) : hh(t, e, l);
  }
  function hh(t, e, l) {
    e.status = "fulfilled", e.value = l, dh(e), t.state = l, e = t.pending, e !== null && (l = e.next, l === e ? t.pending = null : (l = l.next, e.next = l, sh(t, l)));
  }
  function Ao(t, e, l) {
    var i = t.pending;
    if (t.pending = null, i !== null) {
      i = i.next;
      do
        e.status = "rejected", e.reason = l, dh(e), e = e.next;
      while (e !== i);
    }
    t.action = null;
  }
  function dh(t) {
    t = t.listeners;
    for (var e = 0; e < t.length; e++) (0, t[e])();
  }
  function ph(t, e) {
    return e;
  }
  function mh(t, e) {
    if (zt) {
      var l = It.formState;
      if (l !== null) {
        t: {
          var i = yt;
          if (zt) {
            if (Gt) {
              e: {
                for (var o = Gt, s = Ke; o.nodeType !== 8; ) {
                  if (!s) {
                    o = null;
                    break e;
                  }
                  if (o = Fe(
                    o.nextSibling
                  ), o === null) {
                    o = null;
                    break e;
                  }
                }
                s = o.data, o = s === "F!" || s === "F" ? o : null;
              }
              if (o) {
                Gt = Fe(
                  o.nextSibling
                ), i = o.data === "F!";
                break t;
              }
            }
            qn(i);
          }
          i = !1;
        }
        i && (e = l[0]);
      }
    }
    return l = xe(), l.memoizedState = l.baseState = e, i = {
      pending: null,
      lanes: 0,
      dispatch: null,
      lastRenderedReducer: ph,
      lastRenderedState: e
    }, l.queue = i, l = Mh.bind(
      null,
      yt,
      i
    ), i.dispatch = l, i = To(!1), s = Do.bind(
      null,
      yt,
      !1,
      i.queue
    ), i = xe(), o = {
      state: e,
      dispatch: null,
      action: t,
      pending: null
    }, i.queue = o, l = Jy.bind(
      null,
      yt,
      o,
      s,
      l
    ), o.dispatch = l, i.memoizedState = t, [e, l, !1];
  }
  function gh(t) {
    var e = $t();
    return yh(e, Bt, t);
  }
  function yh(t, e, l) {
    if (e = Eo(
      t,
      e,
      ph
    )[0], t = du(Tn)[0], typeof e == "object" && e !== null && typeof e.then == "function")
      try {
        var i = $i(e);
      } catch (g) {
        throw g === li ? lu : g;
      }
    else i = e;
    e = $t();
    var o = e.queue, s = o.dispatch;
    return l !== e.memoizedState && (yt.flags |= 2048, oi(
      9,
      { destroy: void 0 },
      Fy.bind(null, o, l),
      null
    )), [i, s, t];
  }
  function Fy(t, e) {
    t.action = e;
  }
  function bh(t) {
    var e = $t(), l = Bt;
    if (l !== null)
      return yh(e, l, t);
    $t(), e = e.memoizedState, l = $t();
    var i = l.queue.dispatch;
    return l.memoizedState = t, [e, i, !1];
  }
  function oi(t, e, l, i) {
    return t = { tag: t, create: l, deps: i, inst: e, next: null }, e = yt.updateQueue, e === null && (e = fu(), yt.updateQueue = e), l = e.lastEffect, l === null ? e.lastEffect = t.next = t : (i = l.next, l.next = t, t.next = i, e.lastEffect = t), t;
  }
  function vh() {
    return $t().memoizedState;
  }
  function pu(t, e, l, i) {
    var o = xe();
    yt.flags |= t, o.memoizedState = oi(
      1 | e,
      { destroy: void 0 },
      l,
      i === void 0 ? null : i
    );
  }
  function mu(t, e, l, i) {
    var o = $t();
    i = i === void 0 ? null : i;
    var s = o.memoizedState.inst;
    Bt !== null && i !== null && mo(i, Bt.memoizedState.deps) ? o.memoizedState = oi(e, s, l, i) : (yt.flags |= t, o.memoizedState = oi(
      1 | e,
      s,
      l,
      i
    ));
  }
  function Sh(t, e) {
    pu(8390656, 8, t, e);
  }
  function Co(t, e) {
    mu(2048, 8, t, e);
  }
  function $y(t) {
    yt.flags |= 4;
    var e = yt.updateQueue;
    if (e === null)
      e = fu(), yt.updateQueue = e, e.events = [t];
    else {
      var l = e.events;
      l === null ? e.events = [t] : l.push(t);
    }
  }
  function Eh(t) {
    var e = $t().memoizedState;
    return $y({ ref: e, nextImpl: t }), function() {
      if ((Rt & 2) !== 0) throw Error(r(440));
      return e.impl.apply(void 0, arguments);
    };
  }
  function xh(t, e) {
    return mu(4, 2, t, e);
  }
  function Th(t, e) {
    return mu(4, 4, t, e);
  }
  function Ah(t, e) {
    if (typeof e == "function") {
      t = t();
      var l = e(t);
      return function() {
        typeof l == "function" ? l() : e(null);
      };
    }
    if (e != null)
      return t = t(), e.current = t, function() {
        e.current = null;
      };
  }
  function Ch(t, e, l) {
    l = l != null ? l.concat([t]) : null, mu(4, 4, Ah.bind(null, e, t), l);
  }
  function _o() {
  }
  function _h(t, e) {
    var l = $t();
    e = e === void 0 ? null : e;
    var i = l.memoizedState;
    return e !== null && mo(e, i[1]) ? i[0] : (l.memoizedState = [t, e], t);
  }
  function kh(t, e) {
    var l = $t();
    e = e === void 0 ? null : e;
    var i = l.memoizedState;
    if (e !== null && mo(e, i[1]))
      return i[0];
    if (i = t(), Al) {
      Te(!0);
      try {
        t();
      } finally {
        Te(!1);
      }
    }
    return l.memoizedState = [i, e], i;
  }
  function ko(t, e, l) {
    return l === void 0 || (xn & 1073741824) !== 0 && (_t & 261930) === 0 ? t.memoizedState = e : (t.memoizedState = l, t = zd(), yt.lanes |= t, Jn |= t, l);
  }
  function zh(t, e, l, i) {
    return Me(l, e) ? l : ai.current !== null ? (t = ko(t, l, i), Me(t, e) || (le = !0), t) : (xn & 42) === 0 || (xn & 1073741824) !== 0 && (_t & 261930) === 0 ? (le = !0, t.memoizedState = l) : (t = zd(), yt.lanes |= t, Jn |= t, e);
  }
  function wh(t, e, l, i, o) {
    var s = I.p;
    I.p = s !== 0 && 8 > s ? s : 8;
    var g = O.T, S = {};
    O.T = S, Do(t, !1, e, l);
    try {
      var C = o(), R = O.S;
      if (R !== null && R(S, C), C !== null && typeof C == "object" && typeof C.then == "function") {
        var V = Xy(
          C,
          i
        );
        Wi(
          t,
          e,
          V,
          qe(t)
        );
      } else
        Wi(
          t,
          e,
          i,
          qe(t)
        );
    } catch (Q) {
      Wi(
        t,
        e,
        { then: function() {
        }, status: "rejected", reason: Q },
        qe()
      );
    } finally {
      I.p = s, g !== null && S.types !== null && (g.types = S.types), O.T = g;
    }
  }
  function Wy() {
  }
  function zo(t, e, l, i) {
    if (t.tag !== 5) throw Error(r(476));
    var o = Dh(t).queue;
    wh(
      t,
      o,
      e,
      et,
      l === null ? Wy : function() {
        return Oh(t), l(i);
      }
    );
  }
  function Dh(t) {
    var e = t.memoizedState;
    if (e !== null) return e;
    e = {
      memoizedState: et,
      baseState: et,
      baseQueue: null,
      queue: {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: Tn,
        lastRenderedState: et
      },
      next: null
    };
    var l = {};
    return e.next = {
      memoizedState: l,
      baseState: l,
      baseQueue: null,
      queue: {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: Tn,
        lastRenderedState: l
      },
      next: null
    }, t.memoizedState = e, t = t.alternate, t !== null && (t.memoizedState = e), e;
  }
  function Oh(t) {
    var e = Dh(t);
    e.next === null && (e = t.alternate.memoizedState), Wi(
      t,
      e.next.queue,
      {},
      qe()
    );
  }
  function wo() {
    return de(ma);
  }
  function Nh() {
    return $t().memoizedState;
  }
  function Rh() {
    return $t().memoizedState;
  }
  function Py(t) {
    for (var e = t.return; e !== null; ) {
      switch (e.tag) {
        case 24:
        case 3:
          var l = qe();
          t = Yn(l);
          var i = Gn(e, t, l);
          i !== null && (Oe(i, e, l), Zi(i, e, l)), e = { cache: lo() }, t.payload = e;
          return;
      }
      e = e.return;
    }
  }
  function t1(t, e, l) {
    var i = qe();
    l = {
      lane: i,
      revertLane: 0,
      gesture: null,
      action: l,
      hasEagerState: !1,
      eagerState: null,
      next: null
    }, gu(t) ? Uh(e, l) : (l = Xr(t, e, l, i), l !== null && (Oe(l, t, i), Lh(l, e, i)));
  }
  function Mh(t, e, l) {
    var i = qe();
    Wi(t, e, l, i);
  }
  function Wi(t, e, l, i) {
    var o = {
      lane: i,
      revertLane: 0,
      gesture: null,
      action: l,
      hasEagerState: !1,
      eagerState: null,
      next: null
    };
    if (gu(t)) Uh(e, o);
    else {
      var s = t.alternate;
      if (t.lanes === 0 && (s === null || s.lanes === 0) && (s = e.lastRenderedReducer, s !== null))
        try {
          var g = e.lastRenderedState, S = s(g, l);
          if (o.hasEagerState = !0, o.eagerState = S, Me(S, g))
            return Fa(t, e, o, 0), It === null && Ja(), !1;
        } catch {
        } finally {
        }
      if (l = Xr(t, e, o, i), l !== null)
        return Oe(l, t, i), Lh(l, e, i), !0;
    }
    return !1;
  }
  function Do(t, e, l, i) {
    if (i = {
      lane: 2,
      revertLane: oc(),
      gesture: null,
      action: i,
      hasEagerState: !1,
      eagerState: null,
      next: null
    }, gu(t)) {
      if (e) throw Error(r(479));
    } else
      e = Xr(
        t,
        l,
        i,
        2
      ), e !== null && Oe(e, t, 2);
  }
  function gu(t) {
    var e = t.alternate;
    return t === yt || e !== null && e === yt;
  }
  function Uh(t, e) {
    ui = cu = !0;
    var l = t.pending;
    l === null ? e.next = e : (e.next = l.next, l.next = e), t.pending = e;
  }
  function Lh(t, e, l) {
    if ((l & 4194048) !== 0) {
      var i = e.lanes;
      i &= t.pendingLanes, l |= i, e.lanes = l, qs(t, l);
    }
  }
  var Pi = {
    readContext: de,
    use: hu,
    useCallback: Kt,
    useContext: Kt,
    useEffect: Kt,
    useImperativeHandle: Kt,
    useLayoutEffect: Kt,
    useInsertionEffect: Kt,
    useMemo: Kt,
    useReducer: Kt,
    useRef: Kt,
    useState: Kt,
    useDebugValue: Kt,
    useDeferredValue: Kt,
    useTransition: Kt,
    useSyncExternalStore: Kt,
    useId: Kt,
    useHostTransitionStatus: Kt,
    useFormState: Kt,
    useActionState: Kt,
    useOptimistic: Kt,
    useMemoCache: Kt,
    useCacheRefresh: Kt
  };
  Pi.useEffectEvent = Kt;
  var Bh = {
    readContext: de,
    use: hu,
    useCallback: function(t, e) {
      return xe().memoizedState = [
        t,
        e === void 0 ? null : e
      ], t;
    },
    useContext: de,
    useEffect: Sh,
    useImperativeHandle: function(t, e, l) {
      l = l != null ? l.concat([t]) : null, pu(
        4194308,
        4,
        Ah.bind(null, e, t),
        l
      );
    },
    useLayoutEffect: function(t, e) {
      return pu(4194308, 4, t, e);
    },
    useInsertionEffect: function(t, e) {
      pu(4, 2, t, e);
    },
    useMemo: function(t, e) {
      var l = xe();
      e = e === void 0 ? null : e;
      var i = t();
      if (Al) {
        Te(!0);
        try {
          t();
        } finally {
          Te(!1);
        }
      }
      return l.memoizedState = [i, e], i;
    },
    useReducer: function(t, e, l) {
      var i = xe();
      if (l !== void 0) {
        var o = l(e);
        if (Al) {
          Te(!0);
          try {
            l(e);
          } finally {
            Te(!1);
          }
        }
      } else o = e;
      return i.memoizedState = i.baseState = o, t = {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: t,
        lastRenderedState: o
      }, i.queue = t, t = t.dispatch = t1.bind(
        null,
        yt,
        t
      ), [i.memoizedState, t];
    },
    useRef: function(t) {
      var e = xe();
      return t = { current: t }, e.memoizedState = t;
    },
    useState: function(t) {
      t = To(t);
      var e = t.queue, l = Mh.bind(null, yt, e);
      return e.dispatch = l, [t.memoizedState, l];
    },
    useDebugValue: _o,
    useDeferredValue: function(t, e) {
      var l = xe();
      return ko(l, t, e);
    },
    useTransition: function() {
      var t = To(!1);
      return t = wh.bind(
        null,
        yt,
        t.queue,
        !0,
        !1
      ), xe().memoizedState = t, [!1, t];
    },
    useSyncExternalStore: function(t, e, l) {
      var i = yt, o = xe();
      if (zt) {
        if (l === void 0)
          throw Error(r(407));
        l = l();
      } else {
        if (l = e(), It === null)
          throw Error(r(349));
        (_t & 127) !== 0 || ih(i, e, l);
      }
      o.memoizedState = l;
      var s = { value: l, getSnapshot: e };
      return o.queue = s, Sh(uh.bind(null, i, s, t), [
        t
      ]), i.flags |= 2048, oi(
        9,
        { destroy: void 0 },
        ah.bind(
          null,
          i,
          s,
          l,
          e
        ),
        null
      ), l;
    },
    useId: function() {
      var t = xe(), e = It.identifierPrefix;
      if (zt) {
        var l = cn, i = on;
        l = (i & ~(1 << 32 - ue(i) - 1)).toString(32) + l, e = "_" + e + "R_" + l, l = su++, 0 < l && (e += "H" + l.toString(32)), e += "_";
      } else
        l = Zy++, e = "_" + e + "r_" + l.toString(32) + "_";
      return t.memoizedState = e;
    },
    useHostTransitionStatus: wo,
    useFormState: mh,
    useActionState: mh,
    useOptimistic: function(t) {
      var e = xe();
      e.memoizedState = e.baseState = t;
      var l = {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: null,
        lastRenderedState: null
      };
      return e.queue = l, e = Do.bind(
        null,
        yt,
        !0,
        l
      ), l.dispatch = e, [t, e];
    },
    useMemoCache: So,
    useCacheRefresh: function() {
      return xe().memoizedState = Py.bind(
        null,
        yt
      );
    },
    useEffectEvent: function(t) {
      var e = xe(), l = { impl: t };
      return e.memoizedState = l, function() {
        if ((Rt & 2) !== 0)
          throw Error(r(440));
        return l.impl.apply(void 0, arguments);
      };
    }
  }, Oo = {
    readContext: de,
    use: hu,
    useCallback: _h,
    useContext: de,
    useEffect: Co,
    useImperativeHandle: Ch,
    useInsertionEffect: xh,
    useLayoutEffect: Th,
    useMemo: kh,
    useReducer: du,
    useRef: vh,
    useState: function() {
      return du(Tn);
    },
    useDebugValue: _o,
    useDeferredValue: function(t, e) {
      var l = $t();
      return zh(
        l,
        Bt.memoizedState,
        t,
        e
      );
    },
    useTransition: function() {
      var t = du(Tn)[0], e = $t().memoizedState;
      return [
        typeof t == "boolean" ? t : $i(t),
        e
      ];
    },
    useSyncExternalStore: lh,
    useId: Nh,
    useHostTransitionStatus: wo,
    useFormState: gh,
    useActionState: gh,
    useOptimistic: function(t, e) {
      var l = $t();
      return ch(l, Bt, t, e);
    },
    useMemoCache: So,
    useCacheRefresh: Rh
  };
  Oo.useEffectEvent = Eh;
  var Hh = {
    readContext: de,
    use: hu,
    useCallback: _h,
    useContext: de,
    useEffect: Co,
    useImperativeHandle: Ch,
    useInsertionEffect: xh,
    useLayoutEffect: Th,
    useMemo: kh,
    useReducer: xo,
    useRef: vh,
    useState: function() {
      return xo(Tn);
    },
    useDebugValue: _o,
    useDeferredValue: function(t, e) {
      var l = $t();
      return Bt === null ? ko(l, t, e) : zh(
        l,
        Bt.memoizedState,
        t,
        e
      );
    },
    useTransition: function() {
      var t = xo(Tn)[0], e = $t().memoizedState;
      return [
        typeof t == "boolean" ? t : $i(t),
        e
      ];
    },
    useSyncExternalStore: lh,
    useId: Nh,
    useHostTransitionStatus: wo,
    useFormState: bh,
    useActionState: bh,
    useOptimistic: function(t, e) {
      var l = $t();
      return Bt !== null ? ch(l, Bt, t, e) : (l.baseState = t, [t, l.queue.dispatch]);
    },
    useMemoCache: So,
    useCacheRefresh: Rh
  };
  Hh.useEffectEvent = Eh;
  function No(t, e, l, i) {
    e = t.memoizedState, l = l(i, e), l = l == null ? e : b({}, e, l), t.memoizedState = l, t.lanes === 0 && (t.updateQueue.baseState = l);
  }
  var Ro = {
    enqueueSetState: function(t, e, l) {
      t = t._reactInternals;
      var i = qe(), o = Yn(i);
      o.payload = e, l != null && (o.callback = l), e = Gn(t, o, i), e !== null && (Oe(e, t, i), Zi(e, t, i));
    },
    enqueueReplaceState: function(t, e, l) {
      t = t._reactInternals;
      var i = qe(), o = Yn(i);
      o.tag = 1, o.payload = e, l != null && (o.callback = l), e = Gn(t, o, i), e !== null && (Oe(e, t, i), Zi(e, t, i));
    },
    enqueueForceUpdate: function(t, e) {
      t = t._reactInternals;
      var l = qe(), i = Yn(l);
      i.tag = 2, e != null && (i.callback = e), e = Gn(t, i, l), e !== null && (Oe(e, t, l), Zi(e, t, l));
    }
  };
  function jh(t, e, l, i, o, s, g) {
    return t = t.stateNode, typeof t.shouldComponentUpdate == "function" ? t.shouldComponentUpdate(i, s, g) : e.prototype && e.prototype.isPureReactComponent ? !ji(l, i) || !ji(o, s) : !0;
  }
  function qh(t, e, l, i) {
    t = e.state, typeof e.componentWillReceiveProps == "function" && e.componentWillReceiveProps(l, i), typeof e.UNSAFE_componentWillReceiveProps == "function" && e.UNSAFE_componentWillReceiveProps(l, i), e.state !== t && Ro.enqueueReplaceState(e, e.state, null);
  }
  function Cl(t, e) {
    var l = e;
    if ("ref" in e) {
      l = {};
      for (var i in e)
        i !== "ref" && (l[i] = e[i]);
    }
    if (t = t.defaultProps) {
      l === e && (l = b({}, l));
      for (var o in t)
        l[o] === void 0 && (l[o] = t[o]);
    }
    return l;
  }
  function Ih(t) {
    Ka(t);
  }
  function Vh(t) {
    console.error(t);
  }
  function Yh(t) {
    Ka(t);
  }
  function yu(t, e) {
    try {
      var l = t.onUncaughtError;
      l(e.value, { componentStack: e.stack });
    } catch (i) {
      setTimeout(function() {
        throw i;
      });
    }
  }
  function Gh(t, e, l) {
    try {
      var i = t.onCaughtError;
      i(l.value, {
        componentStack: l.stack,
        errorBoundary: e.tag === 1 ? e.stateNode : null
      });
    } catch (o) {
      setTimeout(function() {
        throw o;
      });
    }
  }
  function Mo(t, e, l) {
    return l = Yn(l), l.tag = 3, l.payload = { element: null }, l.callback = function() {
      yu(t, e);
    }, l;
  }
  function Qh(t) {
    return t = Yn(t), t.tag = 3, t;
  }
  function Xh(t, e, l, i) {
    var o = l.type.getDerivedStateFromError;
    if (typeof o == "function") {
      var s = i.value;
      t.payload = function() {
        return o(s);
      }, t.callback = function() {
        Gh(e, l, i);
      };
    }
    var g = l.stateNode;
    g !== null && typeof g.componentDidCatch == "function" && (t.callback = function() {
      Gh(e, l, i), typeof o != "function" && (Fn === null ? Fn = /* @__PURE__ */ new Set([this]) : Fn.add(this));
      var S = i.stack;
      this.componentDidCatch(i.value, {
        componentStack: S !== null ? S : ""
      });
    });
  }
  function e1(t, e, l, i, o) {
    if (l.flags |= 32768, i !== null && typeof i == "object" && typeof i.then == "function") {
      if (e = l.alternate, e !== null && ti(
        e,
        l,
        o,
        !0
      ), l = Le.current, l !== null) {
        switch (l.tag) {
          case 31:
          case 13:
            return Je === null ? wu() : l.alternate === null && Jt === 0 && (Jt = 3), l.flags &= -257, l.flags |= 65536, l.lanes = o, i === iu ? l.flags |= 16384 : (e = l.updateQueue, e === null ? l.updateQueue = /* @__PURE__ */ new Set([i]) : e.add(i), ac(t, i, o)), !1;
          case 22:
            return l.flags |= 65536, i === iu ? l.flags |= 16384 : (e = l.updateQueue, e === null ? (e = {
              transitions: null,
              markerInstances: null,
              retryQueue: /* @__PURE__ */ new Set([i])
            }, l.updateQueue = e) : (l = e.retryQueue, l === null ? e.retryQueue = /* @__PURE__ */ new Set([i]) : l.add(i)), ac(t, i, o)), !1;
        }
        throw Error(r(435, l.tag));
      }
      return ac(t, i, o), wu(), !1;
    }
    if (zt)
      return e = Le.current, e !== null ? ((e.flags & 65536) === 0 && (e.flags |= 256), e.flags |= 65536, e.lanes = o, i !== Wr && (t = Error(r(422), { cause: i }), Vi(Qe(t, l)))) : (i !== Wr && (e = Error(r(423), {
        cause: i
      }), Vi(
        Qe(e, l)
      )), t = t.current.alternate, t.flags |= 65536, o &= -o, t.lanes |= o, i = Qe(i, l), o = Mo(
        t.stateNode,
        i,
        o
      ), co(t, o), Jt !== 4 && (Jt = 2)), !1;
    var s = Error(r(520), { cause: i });
    if (s = Qe(s, l), ra === null ? ra = [s] : ra.push(s), Jt !== 4 && (Jt = 2), e === null) return !0;
    i = Qe(i, l), l = e;
    do {
      switch (l.tag) {
        case 3:
          return l.flags |= 65536, t = o & -o, l.lanes |= t, t = Mo(l.stateNode, i, t), co(l, t), !1;
        case 1:
          if (e = l.type, s = l.stateNode, (l.flags & 128) === 0 && (typeof e.getDerivedStateFromError == "function" || s !== null && typeof s.componentDidCatch == "function" && (Fn === null || !Fn.has(s))))
            return l.flags |= 65536, o &= -o, l.lanes |= o, o = Qh(o), Xh(
              o,
              t,
              l,
              i
            ), co(l, o), !1;
      }
      l = l.return;
    } while (l !== null);
    return !1;
  }
  var Uo = Error(r(461)), le = !1;
  function pe(t, e, l, i) {
    e.child = t === null ? Ff(e, null, l, i) : Tl(
      e,
      t.child,
      l,
      i
    );
  }
  function Zh(t, e, l, i, o) {
    l = l.render;
    var s = e.ref;
    if ("ref" in i) {
      var g = {};
      for (var S in i)
        S !== "ref" && (g[S] = i[S]);
    } else g = i;
    return vl(e), i = go(
      t,
      e,
      l,
      g,
      s,
      o
    ), S = yo(), t !== null && !le ? (bo(t, e, o), An(t, e, o)) : (zt && S && Fr(e), e.flags |= 1, pe(t, e, i, o), e.child);
  }
  function Kh(t, e, l, i, o) {
    if (t === null) {
      var s = l.type;
      return typeof s == "function" && !Zr(s) && s.defaultProps === void 0 && l.compare === null ? (e.tag = 15, e.type = s, Jh(
        t,
        e,
        s,
        i,
        o
      )) : (t = Wa(
        l.type,
        null,
        i,
        e,
        e.mode,
        o
      ), t.ref = e.ref, t.return = e, e.child = t);
    }
    if (s = t.child, !Yo(t, o)) {
      var g = s.memoizedProps;
      if (l = l.compare, l = l !== null ? l : ji, l(g, i) && t.ref === e.ref)
        return An(t, e, o);
    }
    return e.flags |= 1, t = bn(s, i), t.ref = e.ref, t.return = e, e.child = t;
  }
  function Jh(t, e, l, i, o) {
    if (t !== null) {
      var s = t.memoizedProps;
      if (ji(s, i) && t.ref === e.ref)
        if (le = !1, e.pendingProps = i = s, Yo(t, o))
          (t.flags & 131072) !== 0 && (le = !0);
        else
          return e.lanes = t.lanes, An(t, e, o);
    }
    return Lo(
      t,
      e,
      l,
      i,
      o
    );
  }
  function Fh(t, e, l, i) {
    var o = i.children, s = t !== null ? t.memoizedState : null;
    if (t === null && e.stateNode === null && (e.stateNode = {
      _visibility: 1,
      _pendingMarkers: null,
      _retryCache: null,
      _transitions: null
    }), i.mode === "hidden") {
      if ((e.flags & 128) !== 0) {
        if (s = s !== null ? s.baseLanes | l : l, t !== null) {
          for (i = e.child = t.child, o = 0; i !== null; )
            o = o | i.lanes | i.childLanes, i = i.sibling;
          i = o & ~s;
        } else i = 0, e.child = null;
        return $h(
          t,
          e,
          s,
          l,
          i
        );
      }
      if ((l & 536870912) !== 0)
        e.memoizedState = { baseLanes: 0, cachePool: null }, t !== null && nu(
          e,
          s !== null ? s.cachePool : null
        ), s !== null ? Pf(e, s) : fo(), th(e);
      else
        return i = e.lanes = 536870912, $h(
          t,
          e,
          s !== null ? s.baseLanes | l : l,
          l,
          i
        );
    } else
      s !== null ? (nu(e, s.cachePool), Pf(e, s), Xn(), e.memoizedState = null) : (t !== null && nu(e, null), fo(), Xn());
    return pe(t, e, o, l), e.child;
  }
  function ta(t, e) {
    return t !== null && t.tag === 22 || e.stateNode !== null || (e.stateNode = {
      _visibility: 1,
      _pendingMarkers: null,
      _retryCache: null,
      _transitions: null
    }), e.sibling;
  }
  function $h(t, e, l, i, o) {
    var s = ao();
    return s = s === null ? null : { parent: ee._currentValue, pool: s }, e.memoizedState = {
      baseLanes: l,
      cachePool: s
    }, t !== null && nu(e, null), fo(), th(e), t !== null && ti(t, e, i, !0), e.childLanes = o, null;
  }
  function bu(t, e) {
    return e = Su(
      { mode: e.mode, children: e.children },
      t.mode
    ), e.ref = t.ref, t.child = e, e.return = t, e;
  }
  function Wh(t, e, l) {
    return Tl(e, t.child, null, l), t = bu(e, e.pendingProps), t.flags |= 2, Be(e), e.memoizedState = null, t;
  }
  function n1(t, e, l) {
    var i = e.pendingProps, o = (e.flags & 128) !== 0;
    if (e.flags &= -129, t === null) {
      if (zt) {
        if (i.mode === "hidden")
          return t = bu(e, i), e.lanes = 536870912, ta(null, t);
        if (po(e), (t = Gt) ? (t = sp(
          t,
          Ke
        ), t = t !== null && t.data === "&" ? t : null, t !== null && (e.memoizedState = {
          dehydrated: t,
          treeContext: Hn !== null ? { id: on, overflow: cn } : null,
          retryLane: 536870912,
          hydrationErrors: null
        }, l = Uf(t), l.return = e, e.child = l, he = e, Gt = null)) : t = null, t === null) throw qn(e);
        return e.lanes = 536870912, null;
      }
      return bu(e, i);
    }
    var s = t.memoizedState;
    if (s !== null) {
      var g = s.dehydrated;
      if (po(e), o)
        if (e.flags & 256)
          e.flags &= -257, e = Wh(
            t,
            e,
            l
          );
        else if (e.memoizedState !== null)
          e.child = t.child, e.flags |= 128, e = null;
        else throw Error(r(558));
      else if (le || ti(t, e, l, !1), o = (l & t.childLanes) !== 0, le || o) {
        if (i = It, i !== null && (g = Is(i, l), g !== 0 && g !== s.retryLane))
          throw s.retryLane = g, ml(t, g), Oe(i, t, g), Uo;
        wu(), e = Wh(
          t,
          e,
          l
        );
      } else
        t = s.treeContext, Gt = Fe(g.nextSibling), he = e, zt = !0, jn = null, Ke = !1, t !== null && Hf(e, t), e = bu(e, i), e.flags |= 4096;
      return e;
    }
    return t = bn(t.child, {
      mode: i.mode,
      children: i.children
    }), t.ref = e.ref, e.child = t, t.return = e, t;
  }
  function vu(t, e) {
    var l = e.ref;
    if (l === null)
      t !== null && t.ref !== null && (e.flags |= 4194816);
    else {
      if (typeof l != "function" && typeof l != "object")
        throw Error(r(284));
      (t === null || t.ref !== l) && (e.flags |= 4194816);
    }
  }
  function Lo(t, e, l, i, o) {
    return vl(e), l = go(
      t,
      e,
      l,
      i,
      void 0,
      o
    ), i = yo(), t !== null && !le ? (bo(t, e, o), An(t, e, o)) : (zt && i && Fr(e), e.flags |= 1, pe(t, e, l, o), e.child);
  }
  function Ph(t, e, l, i, o, s) {
    return vl(e), e.updateQueue = null, l = nh(
      e,
      i,
      l,
      o
    ), eh(t), i = yo(), t !== null && !le ? (bo(t, e, s), An(t, e, s)) : (zt && i && Fr(e), e.flags |= 1, pe(t, e, l, s), e.child);
  }
  function td(t, e, l, i, o) {
    if (vl(e), e.stateNode === null) {
      var s = Fl, g = l.contextType;
      typeof g == "object" && g !== null && (s = de(g)), s = new l(i, s), e.memoizedState = s.state !== null && s.state !== void 0 ? s.state : null, s.updater = Ro, e.stateNode = s, s._reactInternals = e, s = e.stateNode, s.props = i, s.state = e.memoizedState, s.refs = {}, ro(e), g = l.contextType, s.context = typeof g == "object" && g !== null ? de(g) : Fl, s.state = e.memoizedState, g = l.getDerivedStateFromProps, typeof g == "function" && (No(
        e,
        l,
        g,
        i
      ), s.state = e.memoizedState), typeof l.getDerivedStateFromProps == "function" || typeof s.getSnapshotBeforeUpdate == "function" || typeof s.UNSAFE_componentWillMount != "function" && typeof s.componentWillMount != "function" || (g = s.state, typeof s.componentWillMount == "function" && s.componentWillMount(), typeof s.UNSAFE_componentWillMount == "function" && s.UNSAFE_componentWillMount(), g !== s.state && Ro.enqueueReplaceState(s, s.state, null), Ji(e, i, s, o), Ki(), s.state = e.memoizedState), typeof s.componentDidMount == "function" && (e.flags |= 4194308), i = !0;
    } else if (t === null) {
      s = e.stateNode;
      var S = e.memoizedProps, C = Cl(l, S);
      s.props = C;
      var R = s.context, V = l.contextType;
      g = Fl, typeof V == "object" && V !== null && (g = de(V));
      var Q = l.getDerivedStateFromProps;
      V = typeof Q == "function" || typeof s.getSnapshotBeforeUpdate == "function", S = e.pendingProps !== S, V || typeof s.UNSAFE_componentWillReceiveProps != "function" && typeof s.componentWillReceiveProps != "function" || (S || R !== g) && qh(
        e,
        s,
        i,
        g
      ), Vn = !1;
      var M = e.memoizedState;
      s.state = M, Ji(e, i, s, o), Ki(), R = e.memoizedState, S || M !== R || Vn ? (typeof Q == "function" && (No(
        e,
        l,
        Q,
        i
      ), R = e.memoizedState), (C = Vn || jh(
        e,
        l,
        C,
        i,
        M,
        R,
        g
      )) ? (V || typeof s.UNSAFE_componentWillMount != "function" && typeof s.componentWillMount != "function" || (typeof s.componentWillMount == "function" && s.componentWillMount(), typeof s.UNSAFE_componentWillMount == "function" && s.UNSAFE_componentWillMount()), typeof s.componentDidMount == "function" && (e.flags |= 4194308)) : (typeof s.componentDidMount == "function" && (e.flags |= 4194308), e.memoizedProps = i, e.memoizedState = R), s.props = i, s.state = R, s.context = g, i = C) : (typeof s.componentDidMount == "function" && (e.flags |= 4194308), i = !1);
    } else {
      s = e.stateNode, oo(t, e), g = e.memoizedProps, V = Cl(l, g), s.props = V, Q = e.pendingProps, M = s.context, R = l.contextType, C = Fl, typeof R == "object" && R !== null && (C = de(R)), S = l.getDerivedStateFromProps, (R = typeof S == "function" || typeof s.getSnapshotBeforeUpdate == "function") || typeof s.UNSAFE_componentWillReceiveProps != "function" && typeof s.componentWillReceiveProps != "function" || (g !== Q || M !== C) && qh(
        e,
        s,
        i,
        C
      ), Vn = !1, M = e.memoizedState, s.state = M, Ji(e, i, s, o), Ki();
      var L = e.memoizedState;
      g !== Q || M !== L || Vn || t !== null && t.dependencies !== null && tu(t.dependencies) ? (typeof S == "function" && (No(
        e,
        l,
        S,
        i
      ), L = e.memoizedState), (V = Vn || jh(
        e,
        l,
        V,
        i,
        M,
        L,
        C
      ) || t !== null && t.dependencies !== null && tu(t.dependencies)) ? (R || typeof s.UNSAFE_componentWillUpdate != "function" && typeof s.componentWillUpdate != "function" || (typeof s.componentWillUpdate == "function" && s.componentWillUpdate(i, L, C), typeof s.UNSAFE_componentWillUpdate == "function" && s.UNSAFE_componentWillUpdate(
        i,
        L,
        C
      )), typeof s.componentDidUpdate == "function" && (e.flags |= 4), typeof s.getSnapshotBeforeUpdate == "function" && (e.flags |= 1024)) : (typeof s.componentDidUpdate != "function" || g === t.memoizedProps && M === t.memoizedState || (e.flags |= 4), typeof s.getSnapshotBeforeUpdate != "function" || g === t.memoizedProps && M === t.memoizedState || (e.flags |= 1024), e.memoizedProps = i, e.memoizedState = L), s.props = i, s.state = L, s.context = C, i = V) : (typeof s.componentDidUpdate != "function" || g === t.memoizedProps && M === t.memoizedState || (e.flags |= 4), typeof s.getSnapshotBeforeUpdate != "function" || g === t.memoizedProps && M === t.memoizedState || (e.flags |= 1024), i = !1);
    }
    return s = i, vu(t, e), i = (e.flags & 128) !== 0, s || i ? (s = e.stateNode, l = i && typeof l.getDerivedStateFromError != "function" ? null : s.render(), e.flags |= 1, t !== null && i ? (e.child = Tl(
      e,
      t.child,
      null,
      o
    ), e.child = Tl(
      e,
      null,
      l,
      o
    )) : pe(t, e, l, o), e.memoizedState = s.state, t = e.child) : t = An(
      t,
      e,
      o
    ), t;
  }
  function ed(t, e, l, i) {
    return yl(), e.flags |= 256, pe(t, e, l, i), e.child;
  }
  var Bo = {
    dehydrated: null,
    treeContext: null,
    retryLane: 0,
    hydrationErrors: null
  };
  function Ho(t) {
    return { baseLanes: t, cachePool: Gf() };
  }
  function jo(t, e, l) {
    return t = t !== null ? t.childLanes & ~l : 0, e && (t |= je), t;
  }
  function nd(t, e, l) {
    var i = e.pendingProps, o = !1, s = (e.flags & 128) !== 0, g;
    if ((g = s) || (g = t !== null && t.memoizedState === null ? !1 : (Ft.current & 2) !== 0), g && (o = !0, e.flags &= -129), g = (e.flags & 32) !== 0, e.flags &= -33, t === null) {
      if (zt) {
        if (o ? Qn(e) : Xn(), (t = Gt) ? (t = sp(
          t,
          Ke
        ), t = t !== null && t.data !== "&" ? t : null, t !== null && (e.memoizedState = {
          dehydrated: t,
          treeContext: Hn !== null ? { id: on, overflow: cn } : null,
          retryLane: 536870912,
          hydrationErrors: null
        }, l = Uf(t), l.return = e, e.child = l, he = e, Gt = null)) : t = null, t === null) throw qn(e);
        return Ec(t) ? e.lanes = 32 : e.lanes = 536870912, null;
      }
      var S = i.children;
      return i = i.fallback, o ? (Xn(), o = e.mode, S = Su(
        { mode: "hidden", children: S },
        o
      ), i = gl(
        i,
        o,
        l,
        null
      ), S.return = e, i.return = e, S.sibling = i, e.child = S, i = e.child, i.memoizedState = Ho(l), i.childLanes = jo(
        t,
        g,
        l
      ), e.memoizedState = Bo, ta(null, i)) : (Qn(e), qo(e, S));
    }
    var C = t.memoizedState;
    if (C !== null && (S = C.dehydrated, S !== null)) {
      if (s)
        e.flags & 256 ? (Qn(e), e.flags &= -257, e = Io(
          t,
          e,
          l
        )) : e.memoizedState !== null ? (Xn(), e.child = t.child, e.flags |= 128, e = null) : (Xn(), S = i.fallback, o = e.mode, i = Su(
          { mode: "visible", children: i.children },
          o
        ), S = gl(
          S,
          o,
          l,
          null
        ), S.flags |= 2, i.return = e, S.return = e, i.sibling = S, e.child = i, Tl(
          e,
          t.child,
          null,
          l
        ), i = e.child, i.memoizedState = Ho(l), i.childLanes = jo(
          t,
          g,
          l
        ), e.memoizedState = Bo, e = ta(null, i));
      else if (Qn(e), Ec(S)) {
        if (g = S.nextSibling && S.nextSibling.dataset, g) var R = g.dgst;
        g = R, i = Error(r(419)), i.stack = "", i.digest = g, Vi({ value: i, source: null, stack: null }), e = Io(
          t,
          e,
          l
        );
      } else if (le || ti(t, e, l, !1), g = (l & t.childLanes) !== 0, le || g) {
        if (g = It, g !== null && (i = Is(g, l), i !== 0 && i !== C.retryLane))
          throw C.retryLane = i, ml(t, i), Oe(g, t, i), Uo;
        Sc(S) || wu(), e = Io(
          t,
          e,
          l
        );
      } else
        Sc(S) ? (e.flags |= 192, e.child = t.child, e = null) : (t = C.treeContext, Gt = Fe(
          S.nextSibling
        ), he = e, zt = !0, jn = null, Ke = !1, t !== null && Hf(e, t), e = qo(
          e,
          i.children
        ), e.flags |= 4096);
      return e;
    }
    return o ? (Xn(), S = i.fallback, o = e.mode, C = t.child, R = C.sibling, i = bn(C, {
      mode: "hidden",
      children: i.children
    }), i.subtreeFlags = C.subtreeFlags & 65011712, R !== null ? S = bn(
      R,
      S
    ) : (S = gl(
      S,
      o,
      l,
      null
    ), S.flags |= 2), S.return = e, i.return = e, i.sibling = S, e.child = i, ta(null, i), i = e.child, S = t.child.memoizedState, S === null ? S = Ho(l) : (o = S.cachePool, o !== null ? (C = ee._currentValue, o = o.parent !== C ? { parent: C, pool: C } : o) : o = Gf(), S = {
      baseLanes: S.baseLanes | l,
      cachePool: o
    }), i.memoizedState = S, i.childLanes = jo(
      t,
      g,
      l
    ), e.memoizedState = Bo, ta(t.child, i)) : (Qn(e), l = t.child, t = l.sibling, l = bn(l, {
      mode: "visible",
      children: i.children
    }), l.return = e, l.sibling = null, t !== null && (g = e.deletions, g === null ? (e.deletions = [t], e.flags |= 16) : g.push(t)), e.child = l, e.memoizedState = null, l);
  }
  function qo(t, e) {
    return e = Su(
      { mode: "visible", children: e },
      t.mode
    ), e.return = t, t.child = e;
  }
  function Su(t, e) {
    return t = Ue(22, t, null, e), t.lanes = 0, t;
  }
  function Io(t, e, l) {
    return Tl(e, t.child, null, l), t = qo(
      e,
      e.pendingProps.children
    ), t.flags |= 2, e.memoizedState = null, t;
  }
  function ld(t, e, l) {
    t.lanes |= e;
    var i = t.alternate;
    i !== null && (i.lanes |= e), eo(t.return, e, l);
  }
  function Vo(t, e, l, i, o, s) {
    var g = t.memoizedState;
    g === null ? t.memoizedState = {
      isBackwards: e,
      rendering: null,
      renderingStartTime: 0,
      last: i,
      tail: l,
      tailMode: o,
      treeForkCount: s
    } : (g.isBackwards = e, g.rendering = null, g.renderingStartTime = 0, g.last = i, g.tail = l, g.tailMode = o, g.treeForkCount = s);
  }
  function id(t, e, l) {
    var i = e.pendingProps, o = i.revealOrder, s = i.tail;
    i = i.children;
    var g = Ft.current, S = (g & 2) !== 0;
    if (S ? (g = g & 1 | 2, e.flags |= 128) : g &= 1, x(Ft, g), pe(t, e, i, l), i = zt ? Ii : 0, !S && t !== null && (t.flags & 128) !== 0)
      t: for (t = e.child; t !== null; ) {
        if (t.tag === 13)
          t.memoizedState !== null && ld(t, l, e);
        else if (t.tag === 19)
          ld(t, l, e);
        else if (t.child !== null) {
          t.child.return = t, t = t.child;
          continue;
        }
        if (t === e) break t;
        for (; t.sibling === null; ) {
          if (t.return === null || t.return === e)
            break t;
          t = t.return;
        }
        t.sibling.return = t.return, t = t.sibling;
      }
    switch (o) {
      case "forwards":
        for (l = e.child, o = null; l !== null; )
          t = l.alternate, t !== null && ou(t) === null && (o = l), l = l.sibling;
        l = o, l === null ? (o = e.child, e.child = null) : (o = l.sibling, l.sibling = null), Vo(
          e,
          !1,
          o,
          l,
          s,
          i
        );
        break;
      case "backwards":
      case "unstable_legacy-backwards":
        for (l = null, o = e.child, e.child = null; o !== null; ) {
          if (t = o.alternate, t !== null && ou(t) === null) {
            e.child = o;
            break;
          }
          t = o.sibling, o.sibling = l, l = o, o = t;
        }
        Vo(
          e,
          !0,
          l,
          null,
          s,
          i
        );
        break;
      case "together":
        Vo(
          e,
          !1,
          null,
          null,
          void 0,
          i
        );
        break;
      default:
        e.memoizedState = null;
    }
    return e.child;
  }
  function An(t, e, l) {
    if (t !== null && (e.dependencies = t.dependencies), Jn |= e.lanes, (l & e.childLanes) === 0)
      if (t !== null) {
        if (ti(
          t,
          e,
          l,
          !1
        ), (l & e.childLanes) === 0)
          return null;
      } else return null;
    if (t !== null && e.child !== t.child)
      throw Error(r(153));
    if (e.child !== null) {
      for (t = e.child, l = bn(t, t.pendingProps), e.child = l, l.return = e; t.sibling !== null; )
        t = t.sibling, l = l.sibling = bn(t, t.pendingProps), l.return = e;
      l.sibling = null;
    }
    return e.child;
  }
  function Yo(t, e) {
    return (t.lanes & e) !== 0 ? !0 : (t = t.dependencies, !!(t !== null && tu(t)));
  }
  function l1(t, e, l) {
    switch (e.tag) {
      case 3:
        wt(e, e.stateNode.containerInfo), In(e, ee, t.memoizedState.cache), yl();
        break;
      case 27:
      case 5:
        be(e);
        break;
      case 4:
        wt(e, e.stateNode.containerInfo);
        break;
      case 10:
        In(
          e,
          e.type,
          e.memoizedProps.value
        );
        break;
      case 31:
        if (e.memoizedState !== null)
          return e.flags |= 128, po(e), null;
        break;
      case 13:
        var i = e.memoizedState;
        if (i !== null)
          return i.dehydrated !== null ? (Qn(e), e.flags |= 128, null) : (l & e.child.childLanes) !== 0 ? nd(t, e, l) : (Qn(e), t = An(
            t,
            e,
            l
          ), t !== null ? t.sibling : null);
        Qn(e);
        break;
      case 19:
        var o = (t.flags & 128) !== 0;
        if (i = (l & e.childLanes) !== 0, i || (ti(
          t,
          e,
          l,
          !1
        ), i = (l & e.childLanes) !== 0), o) {
          if (i)
            return id(
              t,
              e,
              l
            );
          e.flags |= 128;
        }
        if (o = e.memoizedState, o !== null && (o.rendering = null, o.tail = null, o.lastEffect = null), x(Ft, Ft.current), i) break;
        return null;
      case 22:
        return e.lanes = 0, Fh(
          t,
          e,
          l,
          e.pendingProps
        );
      case 24:
        In(e, ee, t.memoizedState.cache);
    }
    return An(t, e, l);
  }
  function ad(t, e, l) {
    if (t !== null)
      if (t.memoizedProps !== e.pendingProps)
        le = !0;
      else {
        if (!Yo(t, l) && (e.flags & 128) === 0)
          return le = !1, l1(
            t,
            e,
            l
          );
        le = (t.flags & 131072) !== 0;
      }
    else
      le = !1, zt && (e.flags & 1048576) !== 0 && Bf(e, Ii, e.index);
    switch (e.lanes = 0, e.tag) {
      case 16:
        t: {
          var i = e.pendingProps;
          if (t = El(e.elementType), e.type = t, typeof t == "function")
            Zr(t) ? (i = Cl(t, i), e.tag = 1, e = td(
              null,
              e,
              t,
              i,
              l
            )) : (e.tag = 0, e = Lo(
              null,
              e,
              t,
              i,
              l
            ));
          else {
            if (t != null) {
              var o = t.$$typeof;
              if (o === W) {
                e.tag = 11, e = Zh(
                  null,
                  e,
                  t,
                  i,
                  l
                );
                break t;
              } else if (o === J) {
                e.tag = 14, e = Kh(
                  null,
                  e,
                  t,
                  i,
                  l
                );
                break t;
              }
            }
            throw e = P(t) || t, Error(r(306, e, ""));
          }
        }
        return e;
      case 0:
        return Lo(
          t,
          e,
          e.type,
          e.pendingProps,
          l
        );
      case 1:
        return i = e.type, o = Cl(
          i,
          e.pendingProps
        ), td(
          t,
          e,
          i,
          o,
          l
        );
      case 3:
        t: {
          if (wt(
            e,
            e.stateNode.containerInfo
          ), t === null) throw Error(r(387));
          i = e.pendingProps;
          var s = e.memoizedState;
          o = s.element, oo(t, e), Ji(e, i, null, l);
          var g = e.memoizedState;
          if (i = g.cache, In(e, ee, i), i !== s.cache && no(
            e,
            [ee],
            l,
            !0
          ), Ki(), i = g.element, s.isDehydrated)
            if (s = {
              element: i,
              isDehydrated: !1,
              cache: g.cache
            }, e.updateQueue.baseState = s, e.memoizedState = s, e.flags & 256) {
              e = ed(
                t,
                e,
                i,
                l
              );
              break t;
            } else if (i !== o) {
              o = Qe(
                Error(r(424)),
                e
              ), Vi(o), e = ed(
                t,
                e,
                i,
                l
              );
              break t;
            } else {
              switch (t = e.stateNode.containerInfo, t.nodeType) {
                case 9:
                  t = t.body;
                  break;
                default:
                  t = t.nodeName === "HTML" ? t.ownerDocument.body : t;
              }
              for (Gt = Fe(t.firstChild), he = e, zt = !0, jn = null, Ke = !0, l = Ff(
                e,
                null,
                i,
                l
              ), e.child = l; l; )
                l.flags = l.flags & -3 | 4096, l = l.sibling;
            }
          else {
            if (yl(), i === o) {
              e = An(
                t,
                e,
                l
              );
              break t;
            }
            pe(t, e, i, l);
          }
          e = e.child;
        }
        return e;
      case 26:
        return vu(t, e), t === null ? (l = gp(
          e.type,
          null,
          e.pendingProps,
          null
        )) ? e.memoizedState = l : zt || (l = e.type, t = e.pendingProps, i = Lu(
          ut.current
        ).createElement(l), i[fe] = e, i[Ce] = t, me(i, l, t), ce(i), e.stateNode = i) : e.memoizedState = gp(
          e.type,
          t.memoizedProps,
          e.pendingProps,
          t.memoizedState
        ), null;
      case 27:
        return be(e), t === null && zt && (i = e.stateNode = dp(
          e.type,
          e.pendingProps,
          ut.current
        ), he = e, Ke = !0, o = Gt, tl(e.type) ? (xc = o, Gt = Fe(i.firstChild)) : Gt = o), pe(
          t,
          e,
          e.pendingProps.children,
          l
        ), vu(t, e), t === null && (e.flags |= 4194304), e.child;
      case 5:
        return t === null && zt && ((o = i = Gt) && (i = R1(
          i,
          e.type,
          e.pendingProps,
          Ke
        ), i !== null ? (e.stateNode = i, he = e, Gt = Fe(i.firstChild), Ke = !1, o = !0) : o = !1), o || qn(e)), be(e), o = e.type, s = e.pendingProps, g = t !== null ? t.memoizedProps : null, i = s.children, yc(o, s) ? i = null : g !== null && yc(o, g) && (e.flags |= 32), e.memoizedState !== null && (o = go(
          t,
          e,
          Ky,
          null,
          null,
          l
        ), ma._currentValue = o), vu(t, e), pe(t, e, i, l), e.child;
      case 6:
        return t === null && zt && ((t = l = Gt) && (l = M1(
          l,
          e.pendingProps,
          Ke
        ), l !== null ? (e.stateNode = l, he = e, Gt = null, t = !0) : t = !1), t || qn(e)), null;
      case 13:
        return nd(t, e, l);
      case 4:
        return wt(
          e,
          e.stateNode.containerInfo
        ), i = e.pendingProps, t === null ? e.child = Tl(
          e,
          null,
          i,
          l
        ) : pe(t, e, i, l), e.child;
      case 11:
        return Zh(
          t,
          e,
          e.type,
          e.pendingProps,
          l
        );
      case 7:
        return pe(
          t,
          e,
          e.pendingProps,
          l
        ), e.child;
      case 8:
        return pe(
          t,
          e,
          e.pendingProps.children,
          l
        ), e.child;
      case 12:
        return pe(
          t,
          e,
          e.pendingProps.children,
          l
        ), e.child;
      case 10:
        return i = e.pendingProps, In(e, e.type, i.value), pe(t, e, i.children, l), e.child;
      case 9:
        return o = e.type._context, i = e.pendingProps.children, vl(e), o = de(o), i = i(o), e.flags |= 1, pe(t, e, i, l), e.child;
      case 14:
        return Kh(
          t,
          e,
          e.type,
          e.pendingProps,
          l
        );
      case 15:
        return Jh(
          t,
          e,
          e.type,
          e.pendingProps,
          l
        );
      case 19:
        return id(t, e, l);
      case 31:
        return n1(t, e, l);
      case 22:
        return Fh(
          t,
          e,
          l,
          e.pendingProps
        );
      case 24:
        return vl(e), i = de(ee), t === null ? (o = ao(), o === null && (o = It, s = lo(), o.pooledCache = s, s.refCount++, s !== null && (o.pooledCacheLanes |= l), o = s), e.memoizedState = { parent: i, cache: o }, ro(e), In(e, ee, o)) : ((t.lanes & l) !== 0 && (oo(t, e), Ji(e, null, null, l), Ki()), o = t.memoizedState, s = e.memoizedState, o.parent !== i ? (o = { parent: i, cache: i }, e.memoizedState = o, e.lanes === 0 && (e.memoizedState = e.updateQueue.baseState = o), In(e, ee, i)) : (i = s.cache, In(e, ee, i), i !== o.cache && no(
          e,
          [ee],
          l,
          !0
        ))), pe(
          t,
          e,
          e.pendingProps.children,
          l
        ), e.child;
      case 29:
        throw e.pendingProps;
    }
    throw Error(r(156, e.tag));
  }
  function Cn(t) {
    t.flags |= 4;
  }
  function Go(t, e, l, i, o) {
    if ((e = (t.mode & 32) !== 0) && (e = !1), e) {
      if (t.flags |= 16777216, (o & 335544128) === o)
        if (t.stateNode.complete) t.flags |= 8192;
        else if (Nd()) t.flags |= 8192;
        else
          throw xl = iu, uo;
    } else t.flags &= -16777217;
  }
  function ud(t, e) {
    if (e.type !== "stylesheet" || (e.state.loading & 4) !== 0)
      t.flags &= -16777217;
    else if (t.flags |= 16777216, !Ep(e))
      if (Nd()) t.flags |= 8192;
      else
        throw xl = iu, uo;
  }
  function Eu(t, e) {
    e !== null && (t.flags |= 4), t.flags & 16384 && (e = t.tag !== 22 ? Hs() : 536870912, t.lanes |= e, hi |= e);
  }
  function ea(t, e) {
    if (!zt)
      switch (t.tailMode) {
        case "hidden":
          e = t.tail;
          for (var l = null; e !== null; )
            e.alternate !== null && (l = e), e = e.sibling;
          l === null ? t.tail = null : l.sibling = null;
          break;
        case "collapsed":
          l = t.tail;
          for (var i = null; l !== null; )
            l.alternate !== null && (i = l), l = l.sibling;
          i === null ? e || t.tail === null ? t.tail = null : t.tail.sibling = null : i.sibling = null;
      }
  }
  function Qt(t) {
    var e = t.alternate !== null && t.alternate.child === t.child, l = 0, i = 0;
    if (e)
      for (var o = t.child; o !== null; )
        l |= o.lanes | o.childLanes, i |= o.subtreeFlags & 65011712, i |= o.flags & 65011712, o.return = t, o = o.sibling;
    else
      for (o = t.child; o !== null; )
        l |= o.lanes | o.childLanes, i |= o.subtreeFlags, i |= o.flags, o.return = t, o = o.sibling;
    return t.subtreeFlags |= i, t.childLanes = l, e;
  }
  function i1(t, e, l) {
    var i = e.pendingProps;
    switch ($r(e), e.tag) {
      case 16:
      case 15:
      case 0:
      case 11:
      case 7:
      case 8:
      case 12:
      case 9:
      case 14:
        return Qt(e), null;
      case 1:
        return Qt(e), null;
      case 3:
        return l = e.stateNode, i = null, t !== null && (i = t.memoizedState.cache), e.memoizedState.cache !== i && (e.flags |= 2048), En(ee), bt(), l.pendingContext && (l.context = l.pendingContext, l.pendingContext = null), (t === null || t.child === null) && (Pl(e) ? Cn(e) : t === null || t.memoizedState.isDehydrated && (e.flags & 256) === 0 || (e.flags |= 1024, Pr())), Qt(e), null;
      case 26:
        var o = e.type, s = e.memoizedState;
        return t === null ? (Cn(e), s !== null ? (Qt(e), ud(e, s)) : (Qt(e), Go(
          e,
          o,
          null,
          i,
          l
        ))) : s ? s !== t.memoizedState ? (Cn(e), Qt(e), ud(e, s)) : (Qt(e), e.flags &= -16777217) : (t = t.memoizedProps, t !== i && Cn(e), Qt(e), Go(
          e,
          o,
          t,
          i,
          l
        )), null;
      case 27:
        if (un(e), l = ut.current, o = e.type, t !== null && e.stateNode != null)
          t.memoizedProps !== i && Cn(e);
        else {
          if (!i) {
            if (e.stateNode === null)
              throw Error(r(166));
            return Qt(e), null;
          }
          t = $.current, Pl(e) ? jf(e) : (t = dp(o, i, l), e.stateNode = t, Cn(e));
        }
        return Qt(e), null;
      case 5:
        if (un(e), o = e.type, t !== null && e.stateNode != null)
          t.memoizedProps !== i && Cn(e);
        else {
          if (!i) {
            if (e.stateNode === null)
              throw Error(r(166));
            return Qt(e), null;
          }
          if (s = $.current, Pl(e))
            jf(e);
          else {
            var g = Lu(
              ut.current
            );
            switch (s) {
              case 1:
                s = g.createElementNS(
                  "http://www.w3.org/2000/svg",
                  o
                );
                break;
              case 2:
                s = g.createElementNS(
                  "http://www.w3.org/1998/Math/MathML",
                  o
                );
                break;
              default:
                switch (o) {
                  case "svg":
                    s = g.createElementNS(
                      "http://www.w3.org/2000/svg",
                      o
                    );
                    break;
                  case "math":
                    s = g.createElementNS(
                      "http://www.w3.org/1998/Math/MathML",
                      o
                    );
                    break;
                  case "script":
                    s = g.createElement("div"), s.innerHTML = "<script><\/script>", s = s.removeChild(
                      s.firstChild
                    );
                    break;
                  case "select":
                    s = typeof i.is == "string" ? g.createElement("select", {
                      is: i.is
                    }) : g.createElement("select"), i.multiple ? s.multiple = !0 : i.size && (s.size = i.size);
                    break;
                  default:
                    s = typeof i.is == "string" ? g.createElement(o, { is: i.is }) : g.createElement(o);
                }
            }
            s[fe] = e, s[Ce] = i;
            t: for (g = e.child; g !== null; ) {
              if (g.tag === 5 || g.tag === 6)
                s.appendChild(g.stateNode);
              else if (g.tag !== 4 && g.tag !== 27 && g.child !== null) {
                g.child.return = g, g = g.child;
                continue;
              }
              if (g === e) break t;
              for (; g.sibling === null; ) {
                if (g.return === null || g.return === e)
                  break t;
                g = g.return;
              }
              g.sibling.return = g.return, g = g.sibling;
            }
            e.stateNode = s;
            t: switch (me(s, o, i), o) {
              case "button":
              case "input":
              case "select":
              case "textarea":
                i = !!i.autoFocus;
                break t;
              case "img":
                i = !0;
                break t;
              default:
                i = !1;
            }
            i && Cn(e);
          }
        }
        return Qt(e), Go(
          e,
          e.type,
          t === null ? null : t.memoizedProps,
          e.pendingProps,
          l
        ), null;
      case 6:
        if (t && e.stateNode != null)
          t.memoizedProps !== i && Cn(e);
        else {
          if (typeof i != "string" && e.stateNode === null)
            throw Error(r(166));
          if (t = ut.current, Pl(e)) {
            if (t = e.stateNode, l = e.memoizedProps, i = null, o = he, o !== null)
              switch (o.tag) {
                case 27:
                case 5:
                  i = o.memoizedProps;
              }
            t[fe] = e, t = !!(t.nodeValue === l || i !== null && i.suppressHydrationWarning === !0 || np(t.nodeValue, l)), t || qn(e, !0);
          } else
            t = Lu(t).createTextNode(
              i
            ), t[fe] = e, e.stateNode = t;
        }
        return Qt(e), null;
      case 31:
        if (l = e.memoizedState, t === null || t.memoizedState !== null) {
          if (i = Pl(e), l !== null) {
            if (t === null) {
              if (!i) throw Error(r(318));
              if (t = e.memoizedState, t = t !== null ? t.dehydrated : null, !t) throw Error(r(557));
              t[fe] = e;
            } else
              yl(), (e.flags & 128) === 0 && (e.memoizedState = null), e.flags |= 4;
            Qt(e), t = !1;
          } else
            l = Pr(), t !== null && t.memoizedState !== null && (t.memoizedState.hydrationErrors = l), t = !0;
          if (!t)
            return e.flags & 256 ? (Be(e), e) : (Be(e), null);
          if ((e.flags & 128) !== 0)
            throw Error(r(558));
        }
        return Qt(e), null;
      case 13:
        if (i = e.memoizedState, t === null || t.memoizedState !== null && t.memoizedState.dehydrated !== null) {
          if (o = Pl(e), i !== null && i.dehydrated !== null) {
            if (t === null) {
              if (!o) throw Error(r(318));
              if (o = e.memoizedState, o = o !== null ? o.dehydrated : null, !o) throw Error(r(317));
              o[fe] = e;
            } else
              yl(), (e.flags & 128) === 0 && (e.memoizedState = null), e.flags |= 4;
            Qt(e), o = !1;
          } else
            o = Pr(), t !== null && t.memoizedState !== null && (t.memoizedState.hydrationErrors = o), o = !0;
          if (!o)
            return e.flags & 256 ? (Be(e), e) : (Be(e), null);
        }
        return Be(e), (e.flags & 128) !== 0 ? (e.lanes = l, e) : (l = i !== null, t = t !== null && t.memoizedState !== null, l && (i = e.child, o = null, i.alternate !== null && i.alternate.memoizedState !== null && i.alternate.memoizedState.cachePool !== null && (o = i.alternate.memoizedState.cachePool.pool), s = null, i.memoizedState !== null && i.memoizedState.cachePool !== null && (s = i.memoizedState.cachePool.pool), s !== o && (i.flags |= 2048)), l !== t && l && (e.child.flags |= 8192), Eu(e, e.updateQueue), Qt(e), null);
      case 4:
        return bt(), t === null && hc(e.stateNode.containerInfo), Qt(e), null;
      case 10:
        return En(e.type), Qt(e), null;
      case 19:
        if (Y(Ft), i = e.memoizedState, i === null) return Qt(e), null;
        if (o = (e.flags & 128) !== 0, s = i.rendering, s === null)
          if (o) ea(i, !1);
          else {
            if (Jt !== 0 || t !== null && (t.flags & 128) !== 0)
              for (t = e.child; t !== null; ) {
                if (s = ou(t), s !== null) {
                  for (e.flags |= 128, ea(i, !1), t = s.updateQueue, e.updateQueue = t, Eu(e, t), e.subtreeFlags = 0, t = l, l = e.child; l !== null; )
                    Mf(l, t), l = l.sibling;
                  return x(
                    Ft,
                    Ft.current & 1 | 2
                  ), zt && vn(e, i.treeForkCount), e.child;
                }
                t = t.sibling;
              }
            i.tail !== null && Ee() > _u && (e.flags |= 128, o = !0, ea(i, !1), e.lanes = 4194304);
          }
        else {
          if (!o)
            if (t = ou(s), t !== null) {
              if (e.flags |= 128, o = !0, t = t.updateQueue, e.updateQueue = t, Eu(e, t), ea(i, !0), i.tail === null && i.tailMode === "hidden" && !s.alternate && !zt)
                return Qt(e), null;
            } else
              2 * Ee() - i.renderingStartTime > _u && l !== 536870912 && (e.flags |= 128, o = !0, ea(i, !1), e.lanes = 4194304);
          i.isBackwards ? (s.sibling = e.child, e.child = s) : (t = i.last, t !== null ? t.sibling = s : e.child = s, i.last = s);
        }
        return i.tail !== null ? (t = i.tail, i.rendering = t, i.tail = t.sibling, i.renderingStartTime = Ee(), t.sibling = null, l = Ft.current, x(
          Ft,
          o ? l & 1 | 2 : l & 1
        ), zt && vn(e, i.treeForkCount), t) : (Qt(e), null);
      case 22:
      case 23:
        return Be(e), ho(), i = e.memoizedState !== null, t !== null ? t.memoizedState !== null !== i && (e.flags |= 8192) : i && (e.flags |= 8192), i ? (l & 536870912) !== 0 && (e.flags & 128) === 0 && (Qt(e), e.subtreeFlags & 6 && (e.flags |= 8192)) : Qt(e), l = e.updateQueue, l !== null && Eu(e, l.retryQueue), l = null, t !== null && t.memoizedState !== null && t.memoizedState.cachePool !== null && (l = t.memoizedState.cachePool.pool), i = null, e.memoizedState !== null && e.memoizedState.cachePool !== null && (i = e.memoizedState.cachePool.pool), i !== l && (e.flags |= 2048), t !== null && Y(Sl), null;
      case 24:
        return l = null, t !== null && (l = t.memoizedState.cache), e.memoizedState.cache !== l && (e.flags |= 2048), En(ee), Qt(e), null;
      case 25:
        return null;
      case 30:
        return null;
    }
    throw Error(r(156, e.tag));
  }
  function a1(t, e) {
    switch ($r(e), e.tag) {
      case 1:
        return t = e.flags, t & 65536 ? (e.flags = t & -65537 | 128, e) : null;
      case 3:
        return En(ee), bt(), t = e.flags, (t & 65536) !== 0 && (t & 128) === 0 ? (e.flags = t & -65537 | 128, e) : null;
      case 26:
      case 27:
      case 5:
        return un(e), null;
      case 31:
        if (e.memoizedState !== null) {
          if (Be(e), e.alternate === null)
            throw Error(r(340));
          yl();
        }
        return t = e.flags, t & 65536 ? (e.flags = t & -65537 | 128, e) : null;
      case 13:
        if (Be(e), t = e.memoizedState, t !== null && t.dehydrated !== null) {
          if (e.alternate === null)
            throw Error(r(340));
          yl();
        }
        return t = e.flags, t & 65536 ? (e.flags = t & -65537 | 128, e) : null;
      case 19:
        return Y(Ft), null;
      case 4:
        return bt(), null;
      case 10:
        return En(e.type), null;
      case 22:
      case 23:
        return Be(e), ho(), t !== null && Y(Sl), t = e.flags, t & 65536 ? (e.flags = t & -65537 | 128, e) : null;
      case 24:
        return En(ee), null;
      case 25:
        return null;
      default:
        return null;
    }
  }
  function rd(t, e) {
    switch ($r(e), e.tag) {
      case 3:
        En(ee), bt();
        break;
      case 26:
      case 27:
      case 5:
        un(e);
        break;
      case 4:
        bt();
        break;
      case 31:
        e.memoizedState !== null && Be(e);
        break;
      case 13:
        Be(e);
        break;
      case 19:
        Y(Ft);
        break;
      case 10:
        En(e.type);
        break;
      case 22:
      case 23:
        Be(e), ho(), t !== null && Y(Sl);
        break;
      case 24:
        En(ee);
    }
  }
  function na(t, e) {
    try {
      var l = e.updateQueue, i = l !== null ? l.lastEffect : null;
      if (i !== null) {
        var o = i.next;
        l = o;
        do {
          if ((l.tag & t) === t) {
            i = void 0;
            var s = l.create, g = l.inst;
            i = s(), g.destroy = i;
          }
          l = l.next;
        } while (l !== o);
      }
    } catch (S) {
      Lt(e, e.return, S);
    }
  }
  function Zn(t, e, l) {
    try {
      var i = e.updateQueue, o = i !== null ? i.lastEffect : null;
      if (o !== null) {
        var s = o.next;
        i = s;
        do {
          if ((i.tag & t) === t) {
            var g = i.inst, S = g.destroy;
            if (S !== void 0) {
              g.destroy = void 0, o = e;
              var C = l, R = S;
              try {
                R();
              } catch (V) {
                Lt(
                  o,
                  C,
                  V
                );
              }
            }
          }
          i = i.next;
        } while (i !== s);
      }
    } catch (V) {
      Lt(e, e.return, V);
    }
  }
  function od(t) {
    var e = t.updateQueue;
    if (e !== null) {
      var l = t.stateNode;
      try {
        Wf(e, l);
      } catch (i) {
        Lt(t, t.return, i);
      }
    }
  }
  function cd(t, e, l) {
    l.props = Cl(
      t.type,
      t.memoizedProps
    ), l.state = t.memoizedState;
    try {
      l.componentWillUnmount();
    } catch (i) {
      Lt(t, e, i);
    }
  }
  function la(t, e) {
    try {
      var l = t.ref;
      if (l !== null) {
        switch (t.tag) {
          case 26:
          case 27:
          case 5:
            var i = t.stateNode;
            break;
          case 30:
            i = t.stateNode;
            break;
          default:
            i = t.stateNode;
        }
        typeof l == "function" ? t.refCleanup = l(i) : l.current = i;
      }
    } catch (o) {
      Lt(t, e, o);
    }
  }
  function sn(t, e) {
    var l = t.ref, i = t.refCleanup;
    if (l !== null)
      if (typeof i == "function")
        try {
          i();
        } catch (o) {
          Lt(t, e, o);
        } finally {
          t.refCleanup = null, t = t.alternate, t != null && (t.refCleanup = null);
        }
      else if (typeof l == "function")
        try {
          l(null);
        } catch (o) {
          Lt(t, e, o);
        }
      else l.current = null;
  }
  function sd(t) {
    var e = t.type, l = t.memoizedProps, i = t.stateNode;
    try {
      t: switch (e) {
        case "button":
        case "input":
        case "select":
        case "textarea":
          l.autoFocus && i.focus();
          break t;
        case "img":
          l.src ? i.src = l.src : l.srcSet && (i.srcset = l.srcSet);
      }
    } catch (o) {
      Lt(t, t.return, o);
    }
  }
  function Qo(t, e, l) {
    try {
      var i = t.stateNode;
      k1(i, t.type, l, e), i[Ce] = e;
    } catch (o) {
      Lt(t, t.return, o);
    }
  }
  function fd(t) {
    return t.tag === 5 || t.tag === 3 || t.tag === 26 || t.tag === 27 && tl(t.type) || t.tag === 4;
  }
  function Xo(t) {
    t: for (; ; ) {
      for (; t.sibling === null; ) {
        if (t.return === null || fd(t.return)) return null;
        t = t.return;
      }
      for (t.sibling.return = t.return, t = t.sibling; t.tag !== 5 && t.tag !== 6 && t.tag !== 18; ) {
        if (t.tag === 27 && tl(t.type) || t.flags & 2 || t.child === null || t.tag === 4) continue t;
        t.child.return = t, t = t.child;
      }
      if (!(t.flags & 2)) return t.stateNode;
    }
  }
  function Zo(t, e, l) {
    var i = t.tag;
    if (i === 5 || i === 6)
      t = t.stateNode, e ? (l.nodeType === 9 ? l.body : l.nodeName === "HTML" ? l.ownerDocument.body : l).insertBefore(t, e) : (e = l.nodeType === 9 ? l.body : l.nodeName === "HTML" ? l.ownerDocument.body : l, e.appendChild(t), l = l._reactRootContainer, l != null || e.onclick !== null || (e.onclick = gn));
    else if (i !== 4 && (i === 27 && tl(t.type) && (l = t.stateNode, e = null), t = t.child, t !== null))
      for (Zo(t, e, l), t = t.sibling; t !== null; )
        Zo(t, e, l), t = t.sibling;
  }
  function xu(t, e, l) {
    var i = t.tag;
    if (i === 5 || i === 6)
      t = t.stateNode, e ? l.insertBefore(t, e) : l.appendChild(t);
    else if (i !== 4 && (i === 27 && tl(t.type) && (l = t.stateNode), t = t.child, t !== null))
      for (xu(t, e, l), t = t.sibling; t !== null; )
        xu(t, e, l), t = t.sibling;
  }
  function hd(t) {
    var e = t.stateNode, l = t.memoizedProps;
    try {
      for (var i = t.type, o = e.attributes; o.length; )
        e.removeAttributeNode(o[0]);
      me(e, i, l), e[fe] = t, e[Ce] = l;
    } catch (s) {
      Lt(t, t.return, s);
    }
  }
  var _n = !1, ie = !1, Ko = !1, dd = typeof WeakSet == "function" ? WeakSet : Set, se = null;
  function u1(t, e) {
    if (t = t.containerInfo, mc = Yu, t = Cf(t), qr(t)) {
      if ("selectionStart" in t)
        var l = {
          start: t.selectionStart,
          end: t.selectionEnd
        };
      else
        t: {
          l = (l = t.ownerDocument) && l.defaultView || window;
          var i = l.getSelection && l.getSelection();
          if (i && i.rangeCount !== 0) {
            l = i.anchorNode;
            var o = i.anchorOffset, s = i.focusNode;
            i = i.focusOffset;
            try {
              l.nodeType, s.nodeType;
            } catch {
              l = null;
              break t;
            }
            var g = 0, S = -1, C = -1, R = 0, V = 0, Q = t, M = null;
            e: for (; ; ) {
              for (var L; Q !== l || o !== 0 && Q.nodeType !== 3 || (S = g + o), Q !== s || i !== 0 && Q.nodeType !== 3 || (C = g + i), Q.nodeType === 3 && (g += Q.nodeValue.length), (L = Q.firstChild) !== null; )
                M = Q, Q = L;
              for (; ; ) {
                if (Q === t) break e;
                if (M === l && ++R === o && (S = g), M === s && ++V === i && (C = g), (L = Q.nextSibling) !== null) break;
                Q = M, M = Q.parentNode;
              }
              Q = L;
            }
            l = S === -1 || C === -1 ? null : { start: S, end: C };
          } else l = null;
        }
      l = l || { start: 0, end: 0 };
    } else l = null;
    for (gc = { focusedElem: t, selectionRange: l }, Yu = !1, se = e; se !== null; )
      if (e = se, t = e.child, (e.subtreeFlags & 1028) !== 0 && t !== null)
        t.return = e, se = t;
      else
        for (; se !== null; ) {
          switch (e = se, s = e.alternate, t = e.flags, e.tag) {
            case 0:
              if ((t & 4) !== 0 && (t = e.updateQueue, t = t !== null ? t.events : null, t !== null))
                for (l = 0; l < t.length; l++)
                  o = t[l], o.ref.impl = o.nextImpl;
              break;
            case 11:
            case 15:
              break;
            case 1:
              if ((t & 1024) !== 0 && s !== null) {
                t = void 0, l = e, o = s.memoizedProps, s = s.memoizedState, i = l.stateNode;
                try {
                  var lt = Cl(
                    l.type,
                    o
                  );
                  t = i.getSnapshotBeforeUpdate(
                    lt,
                    s
                  ), i.__reactInternalSnapshotBeforeUpdate = t;
                } catch (st) {
                  Lt(
                    l,
                    l.return,
                    st
                  );
                }
              }
              break;
            case 3:
              if ((t & 1024) !== 0) {
                if (t = e.stateNode.containerInfo, l = t.nodeType, l === 9)
                  vc(t);
                else if (l === 1)
                  switch (t.nodeName) {
                    case "HEAD":
                    case "HTML":
                    case "BODY":
                      vc(t);
                      break;
                    default:
                      t.textContent = "";
                  }
              }
              break;
            case 5:
            case 26:
            case 27:
            case 6:
            case 4:
            case 17:
              break;
            default:
              if ((t & 1024) !== 0) throw Error(r(163));
          }
          if (t = e.sibling, t !== null) {
            t.return = e.return, se = t;
            break;
          }
          se = e.return;
        }
  }
  function pd(t, e, l) {
    var i = l.flags;
    switch (l.tag) {
      case 0:
      case 11:
      case 15:
        zn(t, l), i & 4 && na(5, l);
        break;
      case 1:
        if (zn(t, l), i & 4)
          if (t = l.stateNode, e === null)
            try {
              t.componentDidMount();
            } catch (g) {
              Lt(l, l.return, g);
            }
          else {
            var o = Cl(
              l.type,
              e.memoizedProps
            );
            e = e.memoizedState;
            try {
              t.componentDidUpdate(
                o,
                e,
                t.__reactInternalSnapshotBeforeUpdate
              );
            } catch (g) {
              Lt(
                l,
                l.return,
                g
              );
            }
          }
        i & 64 && od(l), i & 512 && la(l, l.return);
        break;
      case 3:
        if (zn(t, l), i & 64 && (t = l.updateQueue, t !== null)) {
          if (e = null, l.child !== null)
            switch (l.child.tag) {
              case 27:
              case 5:
                e = l.child.stateNode;
                break;
              case 1:
                e = l.child.stateNode;
            }
          try {
            Wf(t, e);
          } catch (g) {
            Lt(l, l.return, g);
          }
        }
        break;
      case 27:
        e === null && i & 4 && hd(l);
      case 26:
      case 5:
        zn(t, l), e === null && i & 4 && sd(l), i & 512 && la(l, l.return);
        break;
      case 12:
        zn(t, l);
        break;
      case 31:
        zn(t, l), i & 4 && yd(t, l);
        break;
      case 13:
        zn(t, l), i & 4 && bd(t, l), i & 64 && (t = l.memoizedState, t !== null && (t = t.dehydrated, t !== null && (l = m1.bind(
          null,
          l
        ), U1(t, l))));
        break;
      case 22:
        if (i = l.memoizedState !== null || _n, !i) {
          e = e !== null && e.memoizedState !== null || ie, o = _n;
          var s = ie;
          _n = i, (ie = e) && !s ? wn(
            t,
            l,
            (l.subtreeFlags & 8772) !== 0
          ) : zn(t, l), _n = o, ie = s;
        }
        break;
      case 30:
        break;
      default:
        zn(t, l);
    }
  }
  function md(t) {
    var e = t.alternate;
    e !== null && (t.alternate = null, md(e)), t.child = null, t.deletions = null, t.sibling = null, t.tag === 5 && (e = t.stateNode, e !== null && Tr(e)), t.stateNode = null, t.return = null, t.dependencies = null, t.memoizedProps = null, t.memoizedState = null, t.pendingProps = null, t.stateNode = null, t.updateQueue = null;
  }
  var Zt = null, ke = !1;
  function kn(t, e, l) {
    for (l = l.child; l !== null; )
      gd(t, e, l), l = l.sibling;
  }
  function gd(t, e, l) {
    if (Xt && typeof Xt.onCommitFiberUnmount == "function")
      try {
        Xt.onCommitFiberUnmount(te, l);
      } catch {
      }
    switch (l.tag) {
      case 26:
        ie || sn(l, e), kn(
          t,
          e,
          l
        ), l.memoizedState ? l.memoizedState.count-- : l.stateNode && (l = l.stateNode, l.parentNode.removeChild(l));
        break;
      case 27:
        ie || sn(l, e);
        var i = Zt, o = ke;
        tl(l.type) && (Zt = l.stateNode, ke = !1), kn(
          t,
          e,
          l
        ), ha(l.stateNode), Zt = i, ke = o;
        break;
      case 5:
        ie || sn(l, e);
      case 6:
        if (i = Zt, o = ke, Zt = null, kn(
          t,
          e,
          l
        ), Zt = i, ke = o, Zt !== null)
          if (ke)
            try {
              (Zt.nodeType === 9 ? Zt.body : Zt.nodeName === "HTML" ? Zt.ownerDocument.body : Zt).removeChild(l.stateNode);
            } catch (s) {
              Lt(
                l,
                e,
                s
              );
            }
          else
            try {
              Zt.removeChild(l.stateNode);
            } catch (s) {
              Lt(
                l,
                e,
                s
              );
            }
        break;
      case 18:
        Zt !== null && (ke ? (t = Zt, op(
          t.nodeType === 9 ? t.body : t.nodeName === "HTML" ? t.ownerDocument.body : t,
          l.stateNode
        ), Si(t)) : op(Zt, l.stateNode));
        break;
      case 4:
        i = Zt, o = ke, Zt = l.stateNode.containerInfo, ke = !0, kn(
          t,
          e,
          l
        ), Zt = i, ke = o;
        break;
      case 0:
      case 11:
      case 14:
      case 15:
        Zn(2, l, e), ie || Zn(4, l, e), kn(
          t,
          e,
          l
        );
        break;
      case 1:
        ie || (sn(l, e), i = l.stateNode, typeof i.componentWillUnmount == "function" && cd(
          l,
          e,
          i
        )), kn(
          t,
          e,
          l
        );
        break;
      case 21:
        kn(
          t,
          e,
          l
        );
        break;
      case 22:
        ie = (i = ie) || l.memoizedState !== null, kn(
          t,
          e,
          l
        ), ie = i;
        break;
      default:
        kn(
          t,
          e,
          l
        );
    }
  }
  function yd(t, e) {
    if (e.memoizedState === null && (t = e.alternate, t !== null && (t = t.memoizedState, t !== null))) {
      t = t.dehydrated;
      try {
        Si(t);
      } catch (l) {
        Lt(e, e.return, l);
      }
    }
  }
  function bd(t, e) {
    if (e.memoizedState === null && (t = e.alternate, t !== null && (t = t.memoizedState, t !== null && (t = t.dehydrated, t !== null))))
      try {
        Si(t);
      } catch (l) {
        Lt(e, e.return, l);
      }
  }
  function r1(t) {
    switch (t.tag) {
      case 31:
      case 13:
      case 19:
        var e = t.stateNode;
        return e === null && (e = t.stateNode = new dd()), e;
      case 22:
        return t = t.stateNode, e = t._retryCache, e === null && (e = t._retryCache = new dd()), e;
      default:
        throw Error(r(435, t.tag));
    }
  }
  function Tu(t, e) {
    var l = r1(t);
    e.forEach(function(i) {
      if (!l.has(i)) {
        l.add(i);
        var o = g1.bind(null, t, i);
        i.then(o, o);
      }
    });
  }
  function ze(t, e) {
    var l = e.deletions;
    if (l !== null)
      for (var i = 0; i < l.length; i++) {
        var o = l[i], s = t, g = e, S = g;
        t: for (; S !== null; ) {
          switch (S.tag) {
            case 27:
              if (tl(S.type)) {
                Zt = S.stateNode, ke = !1;
                break t;
              }
              break;
            case 5:
              Zt = S.stateNode, ke = !1;
              break t;
            case 3:
            case 4:
              Zt = S.stateNode.containerInfo, ke = !0;
              break t;
          }
          S = S.return;
        }
        if (Zt === null) throw Error(r(160));
        gd(s, g, o), Zt = null, ke = !1, s = o.alternate, s !== null && (s.return = null), o.return = null;
      }
    if (e.subtreeFlags & 13886)
      for (e = e.child; e !== null; )
        vd(e, t), e = e.sibling;
  }
  var en = null;
  function vd(t, e) {
    var l = t.alternate, i = t.flags;
    switch (t.tag) {
      case 0:
      case 11:
      case 14:
      case 15:
        ze(e, t), we(t), i & 4 && (Zn(3, t, t.return), na(3, t), Zn(5, t, t.return));
        break;
      case 1:
        ze(e, t), we(t), i & 512 && (ie || l === null || sn(l, l.return)), i & 64 && _n && (t = t.updateQueue, t !== null && (i = t.callbacks, i !== null && (l = t.shared.hiddenCallbacks, t.shared.hiddenCallbacks = l === null ? i : l.concat(i))));
        break;
      case 26:
        var o = en;
        if (ze(e, t), we(t), i & 512 && (ie || l === null || sn(l, l.return)), i & 4) {
          var s = l !== null ? l.memoizedState : null;
          if (i = t.memoizedState, l === null)
            if (i === null)
              if (t.stateNode === null) {
                t: {
                  i = t.type, l = t.memoizedProps, o = o.ownerDocument || o;
                  e: switch (i) {
                    case "title":
                      s = o.getElementsByTagName("title")[0], (!s || s[Di] || s[fe] || s.namespaceURI === "http://www.w3.org/2000/svg" || s.hasAttribute("itemprop")) && (s = o.createElement(i), o.head.insertBefore(
                        s,
                        o.querySelector("head > title")
                      )), me(s, i, l), s[fe] = t, ce(s), i = s;
                      break t;
                    case "link":
                      var g = vp(
                        "link",
                        "href",
                        o
                      ).get(i + (l.href || ""));
                      if (g) {
                        for (var S = 0; S < g.length; S++)
                          if (s = g[S], s.getAttribute("href") === (l.href == null || l.href === "" ? null : l.href) && s.getAttribute("rel") === (l.rel == null ? null : l.rel) && s.getAttribute("title") === (l.title == null ? null : l.title) && s.getAttribute("crossorigin") === (l.crossOrigin == null ? null : l.crossOrigin)) {
                            g.splice(S, 1);
                            break e;
                          }
                      }
                      s = o.createElement(i), me(s, i, l), o.head.appendChild(s);
                      break;
                    case "meta":
                      if (g = vp(
                        "meta",
                        "content",
                        o
                      ).get(i + (l.content || ""))) {
                        for (S = 0; S < g.length; S++)
                          if (s = g[S], s.getAttribute("content") === (l.content == null ? null : "" + l.content) && s.getAttribute("name") === (l.name == null ? null : l.name) && s.getAttribute("property") === (l.property == null ? null : l.property) && s.getAttribute("http-equiv") === (l.httpEquiv == null ? null : l.httpEquiv) && s.getAttribute("charset") === (l.charSet == null ? null : l.charSet)) {
                            g.splice(S, 1);
                            break e;
                          }
                      }
                      s = o.createElement(i), me(s, i, l), o.head.appendChild(s);
                      break;
                    default:
                      throw Error(r(468, i));
                  }
                  s[fe] = t, ce(s), i = s;
                }
                t.stateNode = i;
              } else
                Sp(
                  o,
                  t.type,
                  t.stateNode
                );
            else
              t.stateNode = bp(
                o,
                i,
                t.memoizedProps
              );
          else
            s !== i ? (s === null ? l.stateNode !== null && (l = l.stateNode, l.parentNode.removeChild(l)) : s.count--, i === null ? Sp(
              o,
              t.type,
              t.stateNode
            ) : bp(
              o,
              i,
              t.memoizedProps
            )) : i === null && t.stateNode !== null && Qo(
              t,
              t.memoizedProps,
              l.memoizedProps
            );
        }
        break;
      case 27:
        ze(e, t), we(t), i & 512 && (ie || l === null || sn(l, l.return)), l !== null && i & 4 && Qo(
          t,
          t.memoizedProps,
          l.memoizedProps
        );
        break;
      case 5:
        if (ze(e, t), we(t), i & 512 && (ie || l === null || sn(l, l.return)), t.flags & 32) {
          o = t.stateNode;
          try {
            Yl(o, "");
          } catch (lt) {
            Lt(t, t.return, lt);
          }
        }
        i & 4 && t.stateNode != null && (o = t.memoizedProps, Qo(
          t,
          o,
          l !== null ? l.memoizedProps : o
        )), i & 1024 && (Ko = !0);
        break;
      case 6:
        if (ze(e, t), we(t), i & 4) {
          if (t.stateNode === null)
            throw Error(r(162));
          i = t.memoizedProps, l = t.stateNode;
          try {
            l.nodeValue = i;
          } catch (lt) {
            Lt(t, t.return, lt);
          }
        }
        break;
      case 3:
        if (ju = null, o = en, en = Bu(e.containerInfo), ze(e, t), en = o, we(t), i & 4 && l !== null && l.memoizedState.isDehydrated)
          try {
            Si(e.containerInfo);
          } catch (lt) {
            Lt(t, t.return, lt);
          }
        Ko && (Ko = !1, Sd(t));
        break;
      case 4:
        i = en, en = Bu(
          t.stateNode.containerInfo
        ), ze(e, t), we(t), en = i;
        break;
      case 12:
        ze(e, t), we(t);
        break;
      case 31:
        ze(e, t), we(t), i & 4 && (i = t.updateQueue, i !== null && (t.updateQueue = null, Tu(t, i)));
        break;
      case 13:
        ze(e, t), we(t), t.child.flags & 8192 && t.memoizedState !== null != (l !== null && l.memoizedState !== null) && (Cu = Ee()), i & 4 && (i = t.updateQueue, i !== null && (t.updateQueue = null, Tu(t, i)));
        break;
      case 22:
        o = t.memoizedState !== null;
        var C = l !== null && l.memoizedState !== null, R = _n, V = ie;
        if (_n = R || o, ie = V || C, ze(e, t), ie = V, _n = R, we(t), i & 8192)
          t: for (e = t.stateNode, e._visibility = o ? e._visibility & -2 : e._visibility | 1, o && (l === null || C || _n || ie || _l(t)), l = null, e = t; ; ) {
            if (e.tag === 5 || e.tag === 26) {
              if (l === null) {
                C = l = e;
                try {
                  if (s = C.stateNode, o)
                    g = s.style, typeof g.setProperty == "function" ? g.setProperty("display", "none", "important") : g.display = "none";
                  else {
                    S = C.stateNode;
                    var Q = C.memoizedProps.style, M = Q != null && Q.hasOwnProperty("display") ? Q.display : null;
                    S.style.display = M == null || typeof M == "boolean" ? "" : ("" + M).trim();
                  }
                } catch (lt) {
                  Lt(C, C.return, lt);
                }
              }
            } else if (e.tag === 6) {
              if (l === null) {
                C = e;
                try {
                  C.stateNode.nodeValue = o ? "" : C.memoizedProps;
                } catch (lt) {
                  Lt(C, C.return, lt);
                }
              }
            } else if (e.tag === 18) {
              if (l === null) {
                C = e;
                try {
                  var L = C.stateNode;
                  o ? cp(L, !0) : cp(C.stateNode, !1);
                } catch (lt) {
                  Lt(C, C.return, lt);
                }
              }
            } else if ((e.tag !== 22 && e.tag !== 23 || e.memoizedState === null || e === t) && e.child !== null) {
              e.child.return = e, e = e.child;
              continue;
            }
            if (e === t) break t;
            for (; e.sibling === null; ) {
              if (e.return === null || e.return === t) break t;
              l === e && (l = null), e = e.return;
            }
            l === e && (l = null), e.sibling.return = e.return, e = e.sibling;
          }
        i & 4 && (i = t.updateQueue, i !== null && (l = i.retryQueue, l !== null && (i.retryQueue = null, Tu(t, l))));
        break;
      case 19:
        ze(e, t), we(t), i & 4 && (i = t.updateQueue, i !== null && (t.updateQueue = null, Tu(t, i)));
        break;
      case 30:
        break;
      case 21:
        break;
      default:
        ze(e, t), we(t);
    }
  }
  function we(t) {
    var e = t.flags;
    if (e & 2) {
      try {
        for (var l, i = t.return; i !== null; ) {
          if (fd(i)) {
            l = i;
            break;
          }
          i = i.return;
        }
        if (l == null) throw Error(r(160));
        switch (l.tag) {
          case 27:
            var o = l.stateNode, s = Xo(t);
            xu(t, s, o);
            break;
          case 5:
            var g = l.stateNode;
            l.flags & 32 && (Yl(g, ""), l.flags &= -33);
            var S = Xo(t);
            xu(t, S, g);
            break;
          case 3:
          case 4:
            var C = l.stateNode.containerInfo, R = Xo(t);
            Zo(
              t,
              R,
              C
            );
            break;
          default:
            throw Error(r(161));
        }
      } catch (V) {
        Lt(t, t.return, V);
      }
      t.flags &= -3;
    }
    e & 4096 && (t.flags &= -4097);
  }
  function Sd(t) {
    if (t.subtreeFlags & 1024)
      for (t = t.child; t !== null; ) {
        var e = t;
        Sd(e), e.tag === 5 && e.flags & 1024 && e.stateNode.reset(), t = t.sibling;
      }
  }
  function zn(t, e) {
    if (e.subtreeFlags & 8772)
      for (e = e.child; e !== null; )
        pd(t, e.alternate, e), e = e.sibling;
  }
  function _l(t) {
    for (t = t.child; t !== null; ) {
      var e = t;
      switch (e.tag) {
        case 0:
        case 11:
        case 14:
        case 15:
          Zn(4, e, e.return), _l(e);
          break;
        case 1:
          sn(e, e.return);
          var l = e.stateNode;
          typeof l.componentWillUnmount == "function" && cd(
            e,
            e.return,
            l
          ), _l(e);
          break;
        case 27:
          ha(e.stateNode);
        case 26:
        case 5:
          sn(e, e.return), _l(e);
          break;
        case 22:
          e.memoizedState === null && _l(e);
          break;
        case 30:
          _l(e);
          break;
        default:
          _l(e);
      }
      t = t.sibling;
    }
  }
  function wn(t, e, l) {
    for (l = l && (e.subtreeFlags & 8772) !== 0, e = e.child; e !== null; ) {
      var i = e.alternate, o = t, s = e, g = s.flags;
      switch (s.tag) {
        case 0:
        case 11:
        case 15:
          wn(
            o,
            s,
            l
          ), na(4, s);
          break;
        case 1:
          if (wn(
            o,
            s,
            l
          ), i = s, o = i.stateNode, typeof o.componentDidMount == "function")
            try {
              o.componentDidMount();
            } catch (R) {
              Lt(i, i.return, R);
            }
          if (i = s, o = i.updateQueue, o !== null) {
            var S = i.stateNode;
            try {
              var C = o.shared.hiddenCallbacks;
              if (C !== null)
                for (o.shared.hiddenCallbacks = null, o = 0; o < C.length; o++)
                  $f(C[o], S);
            } catch (R) {
              Lt(i, i.return, R);
            }
          }
          l && g & 64 && od(s), la(s, s.return);
          break;
        case 27:
          hd(s);
        case 26:
        case 5:
          wn(
            o,
            s,
            l
          ), l && i === null && g & 4 && sd(s), la(s, s.return);
          break;
        case 12:
          wn(
            o,
            s,
            l
          );
          break;
        case 31:
          wn(
            o,
            s,
            l
          ), l && g & 4 && yd(o, s);
          break;
        case 13:
          wn(
            o,
            s,
            l
          ), l && g & 4 && bd(o, s);
          break;
        case 22:
          s.memoizedState === null && wn(
            o,
            s,
            l
          ), la(s, s.return);
          break;
        case 30:
          break;
        default:
          wn(
            o,
            s,
            l
          );
      }
      e = e.sibling;
    }
  }
  function Jo(t, e) {
    var l = null;
    t !== null && t.memoizedState !== null && t.memoizedState.cachePool !== null && (l = t.memoizedState.cachePool.pool), t = null, e.memoizedState !== null && e.memoizedState.cachePool !== null && (t = e.memoizedState.cachePool.pool), t !== l && (t != null && t.refCount++, l != null && Yi(l));
  }
  function Fo(t, e) {
    t = null, e.alternate !== null && (t = e.alternate.memoizedState.cache), e = e.memoizedState.cache, e !== t && (e.refCount++, t != null && Yi(t));
  }
  function nn(t, e, l, i) {
    if (e.subtreeFlags & 10256)
      for (e = e.child; e !== null; )
        Ed(
          t,
          e,
          l,
          i
        ), e = e.sibling;
  }
  function Ed(t, e, l, i) {
    var o = e.flags;
    switch (e.tag) {
      case 0:
      case 11:
      case 15:
        nn(
          t,
          e,
          l,
          i
        ), o & 2048 && na(9, e);
        break;
      case 1:
        nn(
          t,
          e,
          l,
          i
        );
        break;
      case 3:
        nn(
          t,
          e,
          l,
          i
        ), o & 2048 && (t = null, e.alternate !== null && (t = e.alternate.memoizedState.cache), e = e.memoizedState.cache, e !== t && (e.refCount++, t != null && Yi(t)));
        break;
      case 12:
        if (o & 2048) {
          nn(
            t,
            e,
            l,
            i
          ), t = e.stateNode;
          try {
            var s = e.memoizedProps, g = s.id, S = s.onPostCommit;
            typeof S == "function" && S(
              g,
              e.alternate === null ? "mount" : "update",
              t.passiveEffectDuration,
              -0
            );
          } catch (C) {
            Lt(e, e.return, C);
          }
        } else
          nn(
            t,
            e,
            l,
            i
          );
        break;
      case 31:
        nn(
          t,
          e,
          l,
          i
        );
        break;
      case 13:
        nn(
          t,
          e,
          l,
          i
        );
        break;
      case 23:
        break;
      case 22:
        s = e.stateNode, g = e.alternate, e.memoizedState !== null ? s._visibility & 2 ? nn(
          t,
          e,
          l,
          i
        ) : ia(t, e) : s._visibility & 2 ? nn(
          t,
          e,
          l,
          i
        ) : (s._visibility |= 2, ci(
          t,
          e,
          l,
          i,
          (e.subtreeFlags & 10256) !== 0 || !1
        )), o & 2048 && Jo(g, e);
        break;
      case 24:
        nn(
          t,
          e,
          l,
          i
        ), o & 2048 && Fo(e.alternate, e);
        break;
      default:
        nn(
          t,
          e,
          l,
          i
        );
    }
  }
  function ci(t, e, l, i, o) {
    for (o = o && ((e.subtreeFlags & 10256) !== 0 || !1), e = e.child; e !== null; ) {
      var s = t, g = e, S = l, C = i, R = g.flags;
      switch (g.tag) {
        case 0:
        case 11:
        case 15:
          ci(
            s,
            g,
            S,
            C,
            o
          ), na(8, g);
          break;
        case 23:
          break;
        case 22:
          var V = g.stateNode;
          g.memoizedState !== null ? V._visibility & 2 ? ci(
            s,
            g,
            S,
            C,
            o
          ) : ia(
            s,
            g
          ) : (V._visibility |= 2, ci(
            s,
            g,
            S,
            C,
            o
          )), o && R & 2048 && Jo(
            g.alternate,
            g
          );
          break;
        case 24:
          ci(
            s,
            g,
            S,
            C,
            o
          ), o && R & 2048 && Fo(g.alternate, g);
          break;
        default:
          ci(
            s,
            g,
            S,
            C,
            o
          );
      }
      e = e.sibling;
    }
  }
  function ia(t, e) {
    if (e.subtreeFlags & 10256)
      for (e = e.child; e !== null; ) {
        var l = t, i = e, o = i.flags;
        switch (i.tag) {
          case 22:
            ia(l, i), o & 2048 && Jo(
              i.alternate,
              i
            );
            break;
          case 24:
            ia(l, i), o & 2048 && Fo(i.alternate, i);
            break;
          default:
            ia(l, i);
        }
        e = e.sibling;
      }
  }
  var aa = 8192;
  function si(t, e, l) {
    if (t.subtreeFlags & aa)
      for (t = t.child; t !== null; )
        xd(
          t,
          e,
          l
        ), t = t.sibling;
  }
  function xd(t, e, l) {
    switch (t.tag) {
      case 26:
        si(
          t,
          e,
          l
        ), t.flags & aa && t.memoizedState !== null && Z1(
          l,
          en,
          t.memoizedState,
          t.memoizedProps
        );
        break;
      case 5:
        si(
          t,
          e,
          l
        );
        break;
      case 3:
      case 4:
        var i = en;
        en = Bu(t.stateNode.containerInfo), si(
          t,
          e,
          l
        ), en = i;
        break;
      case 22:
        t.memoizedState === null && (i = t.alternate, i !== null && i.memoizedState !== null ? (i = aa, aa = 16777216, si(
          t,
          e,
          l
        ), aa = i) : si(
          t,
          e,
          l
        ));
        break;
      default:
        si(
          t,
          e,
          l
        );
    }
  }
  function Td(t) {
    var e = t.alternate;
    if (e !== null && (t = e.child, t !== null)) {
      e.child = null;
      do
        e = t.sibling, t.sibling = null, t = e;
      while (t !== null);
    }
  }
  function ua(t) {
    var e = t.deletions;
    if ((t.flags & 16) !== 0) {
      if (e !== null)
        for (var l = 0; l < e.length; l++) {
          var i = e[l];
          se = i, Cd(
            i,
            t
          );
        }
      Td(t);
    }
    if (t.subtreeFlags & 10256)
      for (t = t.child; t !== null; )
        Ad(t), t = t.sibling;
  }
  function Ad(t) {
    switch (t.tag) {
      case 0:
      case 11:
      case 15:
        ua(t), t.flags & 2048 && Zn(9, t, t.return);
        break;
      case 3:
        ua(t);
        break;
      case 12:
        ua(t);
        break;
      case 22:
        var e = t.stateNode;
        t.memoizedState !== null && e._visibility & 2 && (t.return === null || t.return.tag !== 13) ? (e._visibility &= -3, Au(t)) : ua(t);
        break;
      default:
        ua(t);
    }
  }
  function Au(t) {
    var e = t.deletions;
    if ((t.flags & 16) !== 0) {
      if (e !== null)
        for (var l = 0; l < e.length; l++) {
          var i = e[l];
          se = i, Cd(
            i,
            t
          );
        }
      Td(t);
    }
    for (t = t.child; t !== null; ) {
      switch (e = t, e.tag) {
        case 0:
        case 11:
        case 15:
          Zn(8, e, e.return), Au(e);
          break;
        case 22:
          l = e.stateNode, l._visibility & 2 && (l._visibility &= -3, Au(e));
          break;
        default:
          Au(e);
      }
      t = t.sibling;
    }
  }
  function Cd(t, e) {
    for (; se !== null; ) {
      var l = se;
      switch (l.tag) {
        case 0:
        case 11:
        case 15:
          Zn(8, l, e);
          break;
        case 23:
        case 22:
          if (l.memoizedState !== null && l.memoizedState.cachePool !== null) {
            var i = l.memoizedState.cachePool.pool;
            i != null && i.refCount++;
          }
          break;
        case 24:
          Yi(l.memoizedState.cache);
      }
      if (i = l.child, i !== null) i.return = l, se = i;
      else
        t: for (l = t; se !== null; ) {
          i = se;
          var o = i.sibling, s = i.return;
          if (md(i), i === l) {
            se = null;
            break t;
          }
          if (o !== null) {
            o.return = s, se = o;
            break t;
          }
          se = s;
        }
    }
  }
  var o1 = {
    getCacheForType: function(t) {
      var e = de(ee), l = e.data.get(t);
      return l === void 0 && (l = t(), e.data.set(t, l)), l;
    },
    cacheSignal: function() {
      return de(ee).controller.signal;
    }
  }, c1 = typeof WeakMap == "function" ? WeakMap : Map, Rt = 0, It = null, Tt = null, _t = 0, Ut = 0, He = null, Kn = !1, fi = !1, $o = !1, Dn = 0, Jt = 0, Jn = 0, kl = 0, Wo = 0, je = 0, hi = 0, ra = null, De = null, Po = !1, Cu = 0, _d = 0, _u = 1 / 0, ku = null, Fn = null, re = 0, $n = null, di = null, On = 0, tc = 0, ec = null, kd = null, oa = 0, nc = null;
  function qe() {
    return (Rt & 2) !== 0 && _t !== 0 ? _t & -_t : O.T !== null ? oc() : Vs();
  }
  function zd() {
    if (je === 0)
      if ((_t & 536870912) === 0 || zt) {
        var t = Pe;
        Pe <<= 1, (Pe & 3932160) === 0 && (Pe = 262144), je = t;
      } else je = 536870912;
    return t = Le.current, t !== null && (t.flags |= 32), je;
  }
  function Oe(t, e, l) {
    (t === It && (Ut === 2 || Ut === 9) || t.cancelPendingCommit !== null) && (pi(t, 0), Wn(
      t,
      _t,
      je,
      !1
    )), wi(t, l), ((Rt & 2) === 0 || t !== It) && (t === It && ((Rt & 2) === 0 && (kl |= l), Jt === 4 && Wn(
      t,
      _t,
      je,
      !1
    )), fn(t));
  }
  function wd(t, e, l) {
    if ((Rt & 6) !== 0) throw Error(r(327));
    var i = !l && (e & 127) === 0 && (e & t.expiredLanes) === 0 || zi(t, e), o = i ? h1(t, e) : ic(t, e, !0), s = i;
    do {
      if (o === 0) {
        fi && !i && Wn(t, e, 0, !1);
        break;
      } else {
        if (l = t.current.alternate, s && !s1(l)) {
          o = ic(t, e, !1), s = !1;
          continue;
        }
        if (o === 2) {
          if (s = e, t.errorRecoveryDisabledLanes & s)
            var g = 0;
          else
            g = t.pendingLanes & -536870913, g = g !== 0 ? g : g & 536870912 ? 536870912 : 0;
          if (g !== 0) {
            e = g;
            t: {
              var S = t;
              o = ra;
              var C = S.current.memoizedState.isDehydrated;
              if (C && (pi(S, g).flags |= 256), g = ic(
                S,
                g,
                !1
              ), g !== 2) {
                if ($o && !C) {
                  S.errorRecoveryDisabledLanes |= s, kl |= s, o = 4;
                  break t;
                }
                s = De, De = o, s !== null && (De === null ? De = s : De.push.apply(
                  De,
                  s
                ));
              }
              o = g;
            }
            if (s = !1, o !== 2) continue;
          }
        }
        if (o === 1) {
          pi(t, 0), Wn(t, e, 0, !0);
          break;
        }
        t: {
          switch (i = t, s = o, s) {
            case 0:
            case 1:
              throw Error(r(345));
            case 4:
              if ((e & 4194048) !== e) break;
            case 6:
              Wn(
                i,
                e,
                je,
                !Kn
              );
              break t;
            case 2:
              De = null;
              break;
            case 3:
            case 5:
              break;
            default:
              throw Error(r(329));
          }
          if ((e & 62914560) === e && (o = Cu + 300 - Ee(), 10 < o)) {
            if (Wn(
              i,
              e,
              je,
              !Kn
            ), Ba(i, 0, !0) !== 0) break t;
            On = e, i.timeoutHandle = up(
              Dd.bind(
                null,
                i,
                l,
                De,
                ku,
                Po,
                e,
                je,
                kl,
                hi,
                Kn,
                s,
                "Throttled",
                -0,
                0
              ),
              o
            );
            break t;
          }
          Dd(
            i,
            l,
            De,
            ku,
            Po,
            e,
            je,
            kl,
            hi,
            Kn,
            s,
            null,
            -0,
            0
          );
        }
      }
      break;
    } while (!0);
    fn(t);
  }
  function Dd(t, e, l, i, o, s, g, S, C, R, V, Q, M, L) {
    if (t.timeoutHandle = -1, Q = e.subtreeFlags, Q & 8192 || (Q & 16785408) === 16785408) {
      Q = {
        stylesheets: null,
        count: 0,
        imgCount: 0,
        imgBytes: 0,
        suspenseyImages: [],
        waitingForImages: !0,
        waitingForViewTransition: !1,
        unsuspend: gn
      }, xd(
        e,
        s,
        Q
      );
      var lt = (s & 62914560) === s ? Cu - Ee() : (s & 4194048) === s ? _d - Ee() : 0;
      if (lt = K1(
        Q,
        lt
      ), lt !== null) {
        On = s, t.cancelPendingCommit = lt(
          Hd.bind(
            null,
            t,
            e,
            s,
            l,
            i,
            o,
            g,
            S,
            C,
            V,
            Q,
            null,
            M,
            L
          )
        ), Wn(t, s, g, !R);
        return;
      }
    }
    Hd(
      t,
      e,
      s,
      l,
      i,
      o,
      g,
      S,
      C
    );
  }
  function s1(t) {
    for (var e = t; ; ) {
      var l = e.tag;
      if ((l === 0 || l === 11 || l === 15) && e.flags & 16384 && (l = e.updateQueue, l !== null && (l = l.stores, l !== null)))
        for (var i = 0; i < l.length; i++) {
          var o = l[i], s = o.getSnapshot;
          o = o.value;
          try {
            if (!Me(s(), o)) return !1;
          } catch {
            return !1;
          }
        }
      if (l = e.child, e.subtreeFlags & 16384 && l !== null)
        l.return = e, e = l;
      else {
        if (e === t) break;
        for (; e.sibling === null; ) {
          if (e.return === null || e.return === t) return !0;
          e = e.return;
        }
        e.sibling.return = e.return, e = e.sibling;
      }
    }
    return !0;
  }
  function Wn(t, e, l, i) {
    e &= ~Wo, e &= ~kl, t.suspendedLanes |= e, t.pingedLanes &= ~e, i && (t.warmLanes |= e), i = t.expirationTimes;
    for (var o = e; 0 < o; ) {
      var s = 31 - ue(o), g = 1 << s;
      i[s] = -1, o &= ~g;
    }
    l !== 0 && js(t, l, e);
  }
  function zu() {
    return (Rt & 6) === 0 ? (ca(0), !1) : !0;
  }
  function lc() {
    if (Tt !== null) {
      if (Ut === 0)
        var t = Tt.return;
      else
        t = Tt, Sn = bl = null, vo(t), ii = null, Qi = 0, t = Tt;
      for (; t !== null; )
        rd(t.alternate, t), t = t.return;
      Tt = null;
    }
  }
  function pi(t, e) {
    var l = t.timeoutHandle;
    l !== -1 && (t.timeoutHandle = -1, D1(l)), l = t.cancelPendingCommit, l !== null && (t.cancelPendingCommit = null, l()), On = 0, lc(), It = t, Tt = l = bn(t.current, null), _t = e, Ut = 0, He = null, Kn = !1, fi = zi(t, e), $o = !1, hi = je = Wo = kl = Jn = Jt = 0, De = ra = null, Po = !1, (e & 8) !== 0 && (e |= e & 32);
    var i = t.entangledLanes;
    if (i !== 0)
      for (t = t.entanglements, i &= e; 0 < i; ) {
        var o = 31 - ue(i), s = 1 << o;
        e |= t[o], i &= ~s;
      }
    return Dn = e, Ja(), l;
  }
  function Od(t, e) {
    yt = null, O.H = Pi, e === li || e === lu ? (e = Zf(), Ut = 3) : e === uo ? (e = Zf(), Ut = 4) : Ut = e === Uo ? 8 : e !== null && typeof e == "object" && typeof e.then == "function" ? 6 : 1, He = e, Tt === null && (Jt = 1, yu(
      t,
      Qe(e, t.current)
    ));
  }
  function Nd() {
    var t = Le.current;
    return t === null ? !0 : (_t & 4194048) === _t ? Je === null : (_t & 62914560) === _t || (_t & 536870912) !== 0 ? t === Je : !1;
  }
  function Rd() {
    var t = O.H;
    return O.H = Pi, t === null ? Pi : t;
  }
  function Md() {
    var t = O.A;
    return O.A = o1, t;
  }
  function wu() {
    Jt = 4, Kn || (_t & 4194048) !== _t && Le.current !== null || (fi = !0), (Jn & 134217727) === 0 && (kl & 134217727) === 0 || It === null || Wn(
      It,
      _t,
      je,
      !1
    );
  }
  function ic(t, e, l) {
    var i = Rt;
    Rt |= 2;
    var o = Rd(), s = Md();
    (It !== t || _t !== e) && (ku = null, pi(t, e)), e = !1;
    var g = Jt;
    t: do
      try {
        if (Ut !== 0 && Tt !== null) {
          var S = Tt, C = He;
          switch (Ut) {
            case 8:
              lc(), g = 6;
              break t;
            case 3:
            case 2:
            case 9:
            case 6:
              Le.current === null && (e = !0);
              var R = Ut;
              if (Ut = 0, He = null, mi(t, S, C, R), l && fi) {
                g = 0;
                break t;
              }
              break;
            default:
              R = Ut, Ut = 0, He = null, mi(t, S, C, R);
          }
        }
        f1(), g = Jt;
        break;
      } catch (V) {
        Od(t, V);
      }
    while (!0);
    return e && t.shellSuspendCounter++, Sn = bl = null, Rt = i, O.H = o, O.A = s, Tt === null && (It = null, _t = 0, Ja()), g;
  }
  function f1() {
    for (; Tt !== null; ) Ud(Tt);
  }
  function h1(t, e) {
    var l = Rt;
    Rt |= 2;
    var i = Rd(), o = Md();
    It !== t || _t !== e ? (ku = null, _u = Ee() + 500, pi(t, e)) : fi = zi(
      t,
      e
    );
    t: do
      try {
        if (Ut !== 0 && Tt !== null) {
          e = Tt;
          var s = He;
          e: switch (Ut) {
            case 1:
              Ut = 0, He = null, mi(t, e, s, 1);
              break;
            case 2:
            case 9:
              if (Qf(s)) {
                Ut = 0, He = null, Ld(e);
                break;
              }
              e = function() {
                Ut !== 2 && Ut !== 9 || It !== t || (Ut = 7), fn(t);
              }, s.then(e, e);
              break t;
            case 3:
              Ut = 7;
              break t;
            case 4:
              Ut = 5;
              break t;
            case 7:
              Qf(s) ? (Ut = 0, He = null, Ld(e)) : (Ut = 0, He = null, mi(t, e, s, 7));
              break;
            case 5:
              var g = null;
              switch (Tt.tag) {
                case 26:
                  g = Tt.memoizedState;
                case 5:
                case 27:
                  var S = Tt;
                  if (g ? Ep(g) : S.stateNode.complete) {
                    Ut = 0, He = null;
                    var C = S.sibling;
                    if (C !== null) Tt = C;
                    else {
                      var R = S.return;
                      R !== null ? (Tt = R, Du(R)) : Tt = null;
                    }
                    break e;
                  }
              }
              Ut = 0, He = null, mi(t, e, s, 5);
              break;
            case 6:
              Ut = 0, He = null, mi(t, e, s, 6);
              break;
            case 8:
              lc(), Jt = 6;
              break t;
            default:
              throw Error(r(462));
          }
        }
        d1();
        break;
      } catch (V) {
        Od(t, V);
      }
    while (!0);
    return Sn = bl = null, O.H = i, O.A = o, Rt = l, Tt !== null ? 0 : (It = null, _t = 0, Ja(), Jt);
  }
  function d1() {
    for (; Tt !== null && !gr(); )
      Ud(Tt);
  }
  function Ud(t) {
    var e = ad(t.alternate, t, Dn);
    t.memoizedProps = t.pendingProps, e === null ? Du(t) : Tt = e;
  }
  function Ld(t) {
    var e = t, l = e.alternate;
    switch (e.tag) {
      case 15:
      case 0:
        e = Ph(
          l,
          e,
          e.pendingProps,
          e.type,
          void 0,
          _t
        );
        break;
      case 11:
        e = Ph(
          l,
          e,
          e.pendingProps,
          e.type.render,
          e.ref,
          _t
        );
        break;
      case 5:
        vo(e);
      default:
        rd(l, e), e = Tt = Mf(e, Dn), e = ad(l, e, Dn);
    }
    t.memoizedProps = t.pendingProps, e === null ? Du(t) : Tt = e;
  }
  function mi(t, e, l, i) {
    Sn = bl = null, vo(e), ii = null, Qi = 0;
    var o = e.return;
    try {
      if (e1(
        t,
        o,
        e,
        l,
        _t
      )) {
        Jt = 1, yu(
          t,
          Qe(l, t.current)
        ), Tt = null;
        return;
      }
    } catch (s) {
      if (o !== null) throw Tt = o, s;
      Jt = 1, yu(
        t,
        Qe(l, t.current)
      ), Tt = null;
      return;
    }
    e.flags & 32768 ? (zt || i === 1 ? t = !0 : fi || (_t & 536870912) !== 0 ? t = !1 : (Kn = t = !0, (i === 2 || i === 9 || i === 3 || i === 6) && (i = Le.current, i !== null && i.tag === 13 && (i.flags |= 16384))), Bd(e, t)) : Du(e);
  }
  function Du(t) {
    var e = t;
    do {
      if ((e.flags & 32768) !== 0) {
        Bd(
          e,
          Kn
        );
        return;
      }
      t = e.return;
      var l = i1(
        e.alternate,
        e,
        Dn
      );
      if (l !== null) {
        Tt = l;
        return;
      }
      if (e = e.sibling, e !== null) {
        Tt = e;
        return;
      }
      Tt = e = t;
    } while (e !== null);
    Jt === 0 && (Jt = 5);
  }
  function Bd(t, e) {
    do {
      var l = a1(t.alternate, t);
      if (l !== null) {
        l.flags &= 32767, Tt = l;
        return;
      }
      if (l = t.return, l !== null && (l.flags |= 32768, l.subtreeFlags = 0, l.deletions = null), !e && (t = t.sibling, t !== null)) {
        Tt = t;
        return;
      }
      Tt = t = l;
    } while (t !== null);
    Jt = 6, Tt = null;
  }
  function Hd(t, e, l, i, o, s, g, S, C) {
    t.cancelPendingCommit = null;
    do
      Ou();
    while (re !== 0);
    if ((Rt & 6) !== 0) throw Error(r(327));
    if (e !== null) {
      if (e === t.current) throw Error(r(177));
      if (s = e.lanes | e.childLanes, s |= Qr, Xg(
        t,
        l,
        s,
        g,
        S,
        C
      ), t === It && (Tt = It = null, _t = 0), di = e, $n = t, On = l, tc = s, ec = o, kd = i, (e.subtreeFlags & 10256) !== 0 || (e.flags & 10256) !== 0 ? (t.callbackNode = null, t.callbackPriority = 0, y1(K, function() {
        return Yd(), null;
      })) : (t.callbackNode = null, t.callbackPriority = 0), i = (e.flags & 13878) !== 0, (e.subtreeFlags & 13878) !== 0 || i) {
        i = O.T, O.T = null, o = I.p, I.p = 2, g = Rt, Rt |= 4;
        try {
          u1(t, e, l);
        } finally {
          Rt = g, I.p = o, O.T = i;
        }
      }
      re = 1, jd(), qd(), Id();
    }
  }
  function jd() {
    if (re === 1) {
      re = 0;
      var t = $n, e = di, l = (e.flags & 13878) !== 0;
      if ((e.subtreeFlags & 13878) !== 0 || l) {
        l = O.T, O.T = null;
        var i = I.p;
        I.p = 2;
        var o = Rt;
        Rt |= 4;
        try {
          vd(e, t);
          var s = gc, g = Cf(t.containerInfo), S = s.focusedElem, C = s.selectionRange;
          if (g !== S && S && S.ownerDocument && Af(
            S.ownerDocument.documentElement,
            S
          )) {
            if (C !== null && qr(S)) {
              var R = C.start, V = C.end;
              if (V === void 0 && (V = R), "selectionStart" in S)
                S.selectionStart = R, S.selectionEnd = Math.min(
                  V,
                  S.value.length
                );
              else {
                var Q = S.ownerDocument || document, M = Q && Q.defaultView || window;
                if (M.getSelection) {
                  var L = M.getSelection(), lt = S.textContent.length, st = Math.min(C.start, lt), jt = C.end === void 0 ? st : Math.min(C.end, lt);
                  !L.extend && st > jt && (g = jt, jt = st, st = g);
                  var D = Tf(
                    S,
                    st
                  ), k = Tf(
                    S,
                    jt
                  );
                  if (D && k && (L.rangeCount !== 1 || L.anchorNode !== D.node || L.anchorOffset !== D.offset || L.focusNode !== k.node || L.focusOffset !== k.offset)) {
                    var N = Q.createRange();
                    N.setStart(D.node, D.offset), L.removeAllRanges(), st > jt ? (L.addRange(N), L.extend(k.node, k.offset)) : (N.setEnd(k.node, k.offset), L.addRange(N));
                  }
                }
              }
            }
            for (Q = [], L = S; L = L.parentNode; )
              L.nodeType === 1 && Q.push({
                element: L,
                left: L.scrollLeft,
                top: L.scrollTop
              });
            for (typeof S.focus == "function" && S.focus(), S = 0; S < Q.length; S++) {
              var G = Q[S];
              G.element.scrollLeft = G.left, G.element.scrollTop = G.top;
            }
          }
          Yu = !!mc, gc = mc = null;
        } finally {
          Rt = o, I.p = i, O.T = l;
        }
      }
      t.current = e, re = 2;
    }
  }
  function qd() {
    if (re === 2) {
      re = 0;
      var t = $n, e = di, l = (e.flags & 8772) !== 0;
      if ((e.subtreeFlags & 8772) !== 0 || l) {
        l = O.T, O.T = null;
        var i = I.p;
        I.p = 2;
        var o = Rt;
        Rt |= 4;
        try {
          pd(t, e.alternate, e);
        } finally {
          Rt = o, I.p = i, O.T = l;
        }
      }
      re = 3;
    }
  }
  function Id() {
    if (re === 4 || re === 3) {
      re = 0, yr();
      var t = $n, e = di, l = On, i = kd;
      (e.subtreeFlags & 10256) !== 0 || (e.flags & 10256) !== 0 ? re = 5 : (re = 0, di = $n = null, Vd(t, t.pendingLanes));
      var o = t.pendingLanes;
      if (o === 0 && (Fn = null), Er(l), e = e.stateNode, Xt && typeof Xt.onCommitFiberRoot == "function")
        try {
          Xt.onCommitFiberRoot(
            te,
            e,
            void 0,
            (e.current.flags & 128) === 128
          );
        } catch {
        }
      if (i !== null) {
        e = O.T, o = I.p, I.p = 2, O.T = null;
        try {
          for (var s = t.onRecoverableError, g = 0; g < i.length; g++) {
            var S = i[g];
            s(S.value, {
              componentStack: S.stack
            });
          }
        } finally {
          O.T = e, I.p = o;
        }
      }
      (On & 3) !== 0 && Ou(), fn(t), o = t.pendingLanes, (l & 261930) !== 0 && (o & 42) !== 0 ? t === nc ? oa++ : (oa = 0, nc = t) : oa = 0, ca(0);
    }
  }
  function Vd(t, e) {
    (t.pooledCacheLanes &= e) === 0 && (e = t.pooledCache, e != null && (t.pooledCache = null, Yi(e)));
  }
  function Ou() {
    return jd(), qd(), Id(), Yd();
  }
  function Yd() {
    if (re !== 5) return !1;
    var t = $n, e = tc;
    tc = 0;
    var l = Er(On), i = O.T, o = I.p;
    try {
      I.p = 32 > l ? 32 : l, O.T = null, l = ec, ec = null;
      var s = $n, g = On;
      if (re = 0, di = $n = null, On = 0, (Rt & 6) !== 0) throw Error(r(331));
      var S = Rt;
      if (Rt |= 4, Ad(s.current), Ed(
        s,
        s.current,
        g,
        l
      ), Rt = S, ca(0, !1), Xt && typeof Xt.onPostCommitFiberRoot == "function")
        try {
          Xt.onPostCommitFiberRoot(te, s);
        } catch {
        }
      return !0;
    } finally {
      I.p = o, O.T = i, Vd(t, e);
    }
  }
  function Gd(t, e, l) {
    e = Qe(l, e), e = Mo(t.stateNode, e, 2), t = Gn(t, e, 2), t !== null && (wi(t, 2), fn(t));
  }
  function Lt(t, e, l) {
    if (t.tag === 3)
      Gd(t, t, l);
    else
      for (; e !== null; ) {
        if (e.tag === 3) {
          Gd(
            e,
            t,
            l
          );
          break;
        } else if (e.tag === 1) {
          var i = e.stateNode;
          if (typeof e.type.getDerivedStateFromError == "function" || typeof i.componentDidCatch == "function" && (Fn === null || !Fn.has(i))) {
            t = Qe(l, t), l = Qh(2), i = Gn(e, l, 2), i !== null && (Xh(
              l,
              i,
              e,
              t
            ), wi(i, 2), fn(i));
            break;
          }
        }
        e = e.return;
      }
  }
  function ac(t, e, l) {
    var i = t.pingCache;
    if (i === null) {
      i = t.pingCache = new c1();
      var o = /* @__PURE__ */ new Set();
      i.set(e, o);
    } else
      o = i.get(e), o === void 0 && (o = /* @__PURE__ */ new Set(), i.set(e, o));
    o.has(l) || ($o = !0, o.add(l), t = p1.bind(null, t, e, l), e.then(t, t));
  }
  function p1(t, e, l) {
    var i = t.pingCache;
    i !== null && i.delete(e), t.pingedLanes |= t.suspendedLanes & l, t.warmLanes &= ~l, It === t && (_t & l) === l && (Jt === 4 || Jt === 3 && (_t & 62914560) === _t && 300 > Ee() - Cu ? (Rt & 2) === 0 && pi(t, 0) : Wo |= l, hi === _t && (hi = 0)), fn(t);
  }
  function Qd(t, e) {
    e === 0 && (e = Hs()), t = ml(t, e), t !== null && (wi(t, e), fn(t));
  }
  function m1(t) {
    var e = t.memoizedState, l = 0;
    e !== null && (l = e.retryLane), Qd(t, l);
  }
  function g1(t, e) {
    var l = 0;
    switch (t.tag) {
      case 31:
      case 13:
        var i = t.stateNode, o = t.memoizedState;
        o !== null && (l = o.retryLane);
        break;
      case 19:
        i = t.stateNode;
        break;
      case 22:
        i = t.stateNode._retryCache;
        break;
      default:
        throw Error(r(314));
    }
    i !== null && i.delete(e), Qd(t, l);
  }
  function y1(t, e) {
    return Ul(t, e);
  }
  var Nu = null, gi = null, uc = !1, Ru = !1, rc = !1, Pn = 0;
  function fn(t) {
    t !== gi && t.next === null && (gi === null ? Nu = gi = t : gi = gi.next = t), Ru = !0, uc || (uc = !0, v1());
  }
  function ca(t, e) {
    if (!rc && Ru) {
      rc = !0;
      do
        for (var l = !1, i = Nu; i !== null; ) {
          if (t !== 0) {
            var o = i.pendingLanes;
            if (o === 0) var s = 0;
            else {
              var g = i.suspendedLanes, S = i.pingedLanes;
              s = (1 << 31 - ue(42 | t) + 1) - 1, s &= o & ~(g & ~S), s = s & 201326741 ? s & 201326741 | 1 : s ? s | 2 : 0;
            }
            s !== 0 && (l = !0, Jd(i, s));
          } else
            s = _t, s = Ba(
              i,
              i === It ? s : 0,
              i.cancelPendingCommit !== null || i.timeoutHandle !== -1
            ), (s & 3) === 0 || zi(i, s) || (l = !0, Jd(i, s));
          i = i.next;
        }
      while (l);
      rc = !1;
    }
  }
  function b1() {
    Xd();
  }
  function Xd() {
    Ru = uc = !1;
    var t = 0;
    Pn !== 0 && w1() && (t = Pn);
    for (var e = Ee(), l = null, i = Nu; i !== null; ) {
      var o = i.next, s = Zd(i, e);
      s === 0 ? (i.next = null, l === null ? Nu = o : l.next = o, o === null && (gi = l)) : (l = i, (t !== 0 || (s & 3) !== 0) && (Ru = !0)), i = o;
    }
    re !== 0 && re !== 5 || ca(t), Pn !== 0 && (Pn = 0);
  }
  function Zd(t, e) {
    for (var l = t.suspendedLanes, i = t.pingedLanes, o = t.expirationTimes, s = t.pendingLanes & -62914561; 0 < s; ) {
      var g = 31 - ue(s), S = 1 << g, C = o[g];
      C === -1 ? ((S & l) === 0 || (S & i) !== 0) && (o[g] = Qg(S, e)) : C <= e && (t.expiredLanes |= S), s &= ~S;
    }
    if (e = It, l = _t, l = Ba(
      t,
      t === e ? l : 0,
      t.cancelPendingCommit !== null || t.timeoutHandle !== -1
    ), i = t.callbackNode, l === 0 || t === e && (Ut === 2 || Ut === 9) || t.cancelPendingCommit !== null)
      return i !== null && i !== null && Ll(i), t.callbackNode = null, t.callbackPriority = 0;
    if ((l & 3) === 0 || zi(t, l)) {
      if (e = l & -l, e === t.callbackPriority) return e;
      switch (i !== null && Ll(i), Er(l)) {
        case 2:
        case 8:
          l = j;
          break;
        case 32:
          l = K;
          break;
        case 268435456:
          l = gt;
          break;
        default:
          l = K;
      }
      return i = Kd.bind(null, t), l = Ul(l, i), t.callbackPriority = e, t.callbackNode = l, e;
    }
    return i !== null && i !== null && Ll(i), t.callbackPriority = 2, t.callbackNode = null, 2;
  }
  function Kd(t, e) {
    if (re !== 0 && re !== 5)
      return t.callbackNode = null, t.callbackPriority = 0, null;
    var l = t.callbackNode;
    if (Ou() && t.callbackNode !== l)
      return null;
    var i = _t;
    return i = Ba(
      t,
      t === It ? i : 0,
      t.cancelPendingCommit !== null || t.timeoutHandle !== -1
    ), i === 0 ? null : (wd(t, i, e), Zd(t, Ee()), t.callbackNode != null && t.callbackNode === l ? Kd.bind(null, t) : null);
  }
  function Jd(t, e) {
    if (Ou()) return null;
    wd(t, e, !0);
  }
  function v1() {
    O1(function() {
      (Rt & 6) !== 0 ? Ul(
        Ua,
        b1
      ) : Xd();
    });
  }
  function oc() {
    if (Pn === 0) {
      var t = ei;
      t === 0 && (t = oe, oe <<= 1, (oe & 261888) === 0 && (oe = 256)), Pn = t;
    }
    return Pn;
  }
  function Fd(t) {
    return t == null || typeof t == "symbol" || typeof t == "boolean" ? null : typeof t == "function" ? t : Ia("" + t);
  }
  function $d(t, e) {
    var l = e.ownerDocument.createElement("input");
    return l.name = e.name, l.value = e.value, t.id && l.setAttribute("form", t.id), e.parentNode.insertBefore(l, e), t = new FormData(t), l.parentNode.removeChild(l), t;
  }
  function S1(t, e, l, i, o) {
    if (e === "submit" && l && l.stateNode === o) {
      var s = Fd(
        (o[Ce] || null).action
      ), g = i.submitter;
      g && (e = (e = g[Ce] || null) ? Fd(e.formAction) : g.getAttribute("formAction"), e !== null && (s = e, g = null));
      var S = new Qa(
        "action",
        "action",
        null,
        i,
        o
      );
      t.push({
        event: S,
        listeners: [
          {
            instance: null,
            listener: function() {
              if (i.defaultPrevented) {
                if (Pn !== 0) {
                  var C = g ? $d(o, g) : new FormData(o);
                  zo(
                    l,
                    {
                      pending: !0,
                      data: C,
                      method: o.method,
                      action: s
                    },
                    null,
                    C
                  );
                }
              } else
                typeof s == "function" && (S.preventDefault(), C = g ? $d(o, g) : new FormData(o), zo(
                  l,
                  {
                    pending: !0,
                    data: C,
                    method: o.method,
                    action: s
                  },
                  s,
                  C
                ));
            },
            currentTarget: o
          }
        ]
      });
    }
  }
  for (var cc = 0; cc < Gr.length; cc++) {
    var sc = Gr[cc], E1 = sc.toLowerCase(), x1 = sc[0].toUpperCase() + sc.slice(1);
    tn(
      E1,
      "on" + x1
    );
  }
  tn(zf, "onAnimationEnd"), tn(wf, "onAnimationIteration"), tn(Df, "onAnimationStart"), tn("dblclick", "onDoubleClick"), tn("focusin", "onFocus"), tn("focusout", "onBlur"), tn(Hy, "onTransitionRun"), tn(jy, "onTransitionStart"), tn(qy, "onTransitionCancel"), tn(Of, "onTransitionEnd"), Il("onMouseEnter", ["mouseout", "mouseover"]), Il("onMouseLeave", ["mouseout", "mouseover"]), Il("onPointerEnter", ["pointerout", "pointerover"]), Il("onPointerLeave", ["pointerout", "pointerover"]), fl(
    "onChange",
    "change click focusin focusout input keydown keyup selectionchange".split(" ")
  ), fl(
    "onSelect",
    "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(
      " "
    )
  ), fl("onBeforeInput", [
    "compositionend",
    "keypress",
    "textInput",
    "paste"
  ]), fl(
    "onCompositionEnd",
    "compositionend focusout keydown keypress keyup mousedown".split(" ")
  ), fl(
    "onCompositionStart",
    "compositionstart focusout keydown keypress keyup mousedown".split(" ")
  ), fl(
    "onCompositionUpdate",
    "compositionupdate focusout keydown keypress keyup mousedown".split(" ")
  );
  var sa = "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(
    " "
  ), T1 = new Set(
    "beforetoggle cancel close invalid load scroll scrollend toggle".split(" ").concat(sa)
  );
  function Wd(t, e) {
    e = (e & 4) !== 0;
    for (var l = 0; l < t.length; l++) {
      var i = t[l], o = i.event;
      i = i.listeners;
      t: {
        var s = void 0;
        if (e)
          for (var g = i.length - 1; 0 <= g; g--) {
            var S = i[g], C = S.instance, R = S.currentTarget;
            if (S = S.listener, C !== s && o.isPropagationStopped())
              break t;
            s = S, o.currentTarget = R;
            try {
              s(o);
            } catch (V) {
              Ka(V);
            }
            o.currentTarget = null, s = C;
          }
        else
          for (g = 0; g < i.length; g++) {
            if (S = i[g], C = S.instance, R = S.currentTarget, S = S.listener, C !== s && o.isPropagationStopped())
              break t;
            s = S, o.currentTarget = R;
            try {
              s(o);
            } catch (V) {
              Ka(V);
            }
            o.currentTarget = null, s = C;
          }
      }
    }
  }
  function At(t, e) {
    var l = e[xr];
    l === void 0 && (l = e[xr] = /* @__PURE__ */ new Set());
    var i = t + "__bubble";
    l.has(i) || (Pd(e, t, 2, !1), l.add(i));
  }
  function fc(t, e, l) {
    var i = 0;
    e && (i |= 4), Pd(
      l,
      t,
      i,
      e
    );
  }
  var Mu = "_reactListening" + Math.random().toString(36).slice(2);
  function hc(t) {
    if (!t[Mu]) {
      t[Mu] = !0, Qs.forEach(function(l) {
        l !== "selectionchange" && (T1.has(l) || fc(l, !1, t), fc(l, !0, t));
      });
      var e = t.nodeType === 9 ? t : t.ownerDocument;
      e === null || e[Mu] || (e[Mu] = !0, fc("selectionchange", !1, e));
    }
  }
  function Pd(t, e, l, i) {
    switch (zp(e)) {
      case 2:
        var o = $1;
        break;
      case 8:
        o = W1;
        break;
      default:
        o = kc;
    }
    l = o.bind(
      null,
      e,
      l,
      t
    ), o = void 0, !Or || e !== "touchstart" && e !== "touchmove" && e !== "wheel" || (o = !0), i ? o !== void 0 ? t.addEventListener(e, l, {
      capture: !0,
      passive: o
    }) : t.addEventListener(e, l, !0) : o !== void 0 ? t.addEventListener(e, l, {
      passive: o
    }) : t.addEventListener(e, l, !1);
  }
  function dc(t, e, l, i, o) {
    var s = i;
    if ((e & 1) === 0 && (e & 2) === 0 && i !== null)
      t: for (; ; ) {
        if (i === null) return;
        var g = i.tag;
        if (g === 3 || g === 4) {
          var S = i.stateNode.containerInfo;
          if (S === o) break;
          if (g === 4)
            for (g = i.return; g !== null; ) {
              var C = g.tag;
              if ((C === 3 || C === 4) && g.stateNode.containerInfo === o)
                return;
              g = g.return;
            }
          for (; S !== null; ) {
            if (g = Hl(S), g === null) return;
            if (C = g.tag, C === 5 || C === 6 || C === 26 || C === 27) {
              i = s = g;
              continue t;
            }
            S = S.parentNode;
          }
        }
        i = i.return;
      }
    lf(function() {
      var R = s, V = wr(l), Q = [];
      t: {
        var M = Nf.get(t);
        if (M !== void 0) {
          var L = Qa, lt = t;
          switch (t) {
            case "keypress":
              if (Ya(l) === 0) break t;
            case "keydown":
            case "keyup":
              L = gy;
              break;
            case "focusin":
              lt = "focus", L = Ur;
              break;
            case "focusout":
              lt = "blur", L = Ur;
              break;
            case "beforeblur":
            case "afterblur":
              L = Ur;
              break;
            case "click":
              if (l.button === 2) break t;
            case "auxclick":
            case "dblclick":
            case "mousedown":
            case "mousemove":
            case "mouseup":
            case "mouseout":
            case "mouseover":
            case "contextmenu":
              L = rf;
              break;
            case "drag":
            case "dragend":
            case "dragenter":
            case "dragexit":
            case "dragleave":
            case "dragover":
            case "dragstart":
            case "drop":
              L = iy;
              break;
            case "touchcancel":
            case "touchend":
            case "touchmove":
            case "touchstart":
              L = vy;
              break;
            case zf:
            case wf:
            case Df:
              L = ry;
              break;
            case Of:
              L = Ey;
              break;
            case "scroll":
            case "scrollend":
              L = ny;
              break;
            case "wheel":
              L = Ty;
              break;
            case "copy":
            case "cut":
            case "paste":
              L = cy;
              break;
            case "gotpointercapture":
            case "lostpointercapture":
            case "pointercancel":
            case "pointerdown":
            case "pointermove":
            case "pointerout":
            case "pointerover":
            case "pointerup":
              L = cf;
              break;
            case "toggle":
            case "beforetoggle":
              L = Cy;
          }
          var st = (e & 4) !== 0, jt = !st && (t === "scroll" || t === "scrollend"), D = st ? M !== null ? M + "Capture" : null : M;
          st = [];
          for (var k = R, N; k !== null; ) {
            var G = k;
            if (N = G.stateNode, G = G.tag, G !== 5 && G !== 26 && G !== 27 || N === null || D === null || (G = Ni(k, D), G != null && st.push(
              fa(k, G, N)
            )), jt) break;
            k = k.return;
          }
          0 < st.length && (M = new L(
            M,
            lt,
            null,
            l,
            V
          ), Q.push({ event: M, listeners: st }));
        }
      }
      if ((e & 7) === 0) {
        t: {
          if (M = t === "mouseover" || t === "pointerover", L = t === "mouseout" || t === "pointerout", M && l !== zr && (lt = l.relatedTarget || l.fromElement) && (Hl(lt) || lt[Bl]))
            break t;
          if ((L || M) && (M = V.window === V ? V : (M = V.ownerDocument) ? M.defaultView || M.parentWindow : window, L ? (lt = l.relatedTarget || l.toElement, L = R, lt = lt ? Hl(lt) : null, lt !== null && (jt = h(lt), st = lt.tag, lt !== jt || st !== 5 && st !== 27 && st !== 6) && (lt = null)) : (L = null, lt = R), L !== lt)) {
            if (st = rf, G = "onMouseLeave", D = "onMouseEnter", k = "mouse", (t === "pointerout" || t === "pointerover") && (st = cf, G = "onPointerLeave", D = "onPointerEnter", k = "pointer"), jt = L == null ? M : Oi(L), N = lt == null ? M : Oi(lt), M = new st(
              G,
              k + "leave",
              L,
              l,
              V
            ), M.target = jt, M.relatedTarget = N, G = null, Hl(V) === R && (st = new st(
              D,
              k + "enter",
              lt,
              l,
              V
            ), st.target = N, st.relatedTarget = jt, G = st), jt = G, L && lt)
              e: {
                for (st = A1, D = L, k = lt, N = 0, G = D; G; G = st(G))
                  N++;
                G = 0;
                for (var rt = k; rt; rt = st(rt))
                  G++;
                for (; 0 < N - G; )
                  D = st(D), N--;
                for (; 0 < G - N; )
                  k = st(k), G--;
                for (; N--; ) {
                  if (D === k || k !== null && D === k.alternate) {
                    st = D;
                    break e;
                  }
                  D = st(D), k = st(k);
                }
                st = null;
              }
            else st = null;
            L !== null && tp(
              Q,
              M,
              L,
              st,
              !1
            ), lt !== null && jt !== null && tp(
              Q,
              jt,
              lt,
              st,
              !0
            );
          }
        }
        t: {
          if (M = R ? Oi(R) : window, L = M.nodeName && M.nodeName.toLowerCase(), L === "select" || L === "input" && M.type === "file")
            var Dt = yf;
          else if (mf(M))
            if (bf)
              Dt = Uy;
            else {
              Dt = Ry;
              var at = Ny;
            }
          else
            L = M.nodeName, !L || L.toLowerCase() !== "input" || M.type !== "checkbox" && M.type !== "radio" ? R && kr(R.elementType) && (Dt = yf) : Dt = My;
          if (Dt && (Dt = Dt(t, R))) {
            gf(
              Q,
              Dt,
              l,
              V
            );
            break t;
          }
          at && at(t, M, R), t === "focusout" && R && M.type === "number" && R.memoizedProps.value != null && _r(M, "number", M.value);
        }
        switch (at = R ? Oi(R) : window, t) {
          case "focusin":
            (mf(at) || at.contentEditable === "true") && (Zl = at, Ir = R, qi = null);
            break;
          case "focusout":
            qi = Ir = Zl = null;
            break;
          case "mousedown":
            Vr = !0;
            break;
          case "contextmenu":
          case "mouseup":
          case "dragend":
            Vr = !1, _f(Q, l, V);
            break;
          case "selectionchange":
            if (By) break;
          case "keydown":
          case "keyup":
            _f(Q, l, V);
        }
        var vt;
        if (Br)
          t: {
            switch (t) {
              case "compositionstart":
                var kt = "onCompositionStart";
                break t;
              case "compositionend":
                kt = "onCompositionEnd";
                break t;
              case "compositionupdate":
                kt = "onCompositionUpdate";
                break t;
            }
            kt = void 0;
          }
        else
          Xl ? df(t, l) && (kt = "onCompositionEnd") : t === "keydown" && l.keyCode === 229 && (kt = "onCompositionStart");
        kt && (sf && l.locale !== "ko" && (Xl || kt !== "onCompositionStart" ? kt === "onCompositionEnd" && Xl && (vt = af()) : (Bn = V, Nr = "value" in Bn ? Bn.value : Bn.textContent, Xl = !0)), at = Uu(R, kt), 0 < at.length && (kt = new of(
          kt,
          t,
          null,
          l,
          V
        ), Q.push({ event: kt, listeners: at }), vt ? kt.data = vt : (vt = pf(l), vt !== null && (kt.data = vt)))), (vt = ky ? zy(t, l) : wy(t, l)) && (kt = Uu(R, "onBeforeInput"), 0 < kt.length && (at = new of(
          "onBeforeInput",
          "beforeinput",
          null,
          l,
          V
        ), Q.push({
          event: at,
          listeners: kt
        }), at.data = vt)), S1(
          Q,
          t,
          R,
          l,
          V
        );
      }
      Wd(Q, e);
    });
  }
  function fa(t, e, l) {
    return {
      instance: t,
      listener: e,
      currentTarget: l
    };
  }
  function Uu(t, e) {
    for (var l = e + "Capture", i = []; t !== null; ) {
      var o = t, s = o.stateNode;
      if (o = o.tag, o !== 5 && o !== 26 && o !== 27 || s === null || (o = Ni(t, l), o != null && i.unshift(
        fa(t, o, s)
      ), o = Ni(t, e), o != null && i.push(
        fa(t, o, s)
      )), t.tag === 3) return i;
      t = t.return;
    }
    return [];
  }
  function A1(t) {
    if (t === null) return null;
    do
      t = t.return;
    while (t && t.tag !== 5 && t.tag !== 27);
    return t || null;
  }
  function tp(t, e, l, i, o) {
    for (var s = e._reactName, g = []; l !== null && l !== i; ) {
      var S = l, C = S.alternate, R = S.stateNode;
      if (S = S.tag, C !== null && C === i) break;
      S !== 5 && S !== 26 && S !== 27 || R === null || (C = R, o ? (R = Ni(l, s), R != null && g.unshift(
        fa(l, R, C)
      )) : o || (R = Ni(l, s), R != null && g.push(
        fa(l, R, C)
      ))), l = l.return;
    }
    g.length !== 0 && t.push({ event: e, listeners: g });
  }
  var C1 = /\r\n?/g, _1 = /\u0000|\uFFFD/g;
  function ep(t) {
    return (typeof t == "string" ? t : "" + t).replace(C1, `
`).replace(_1, "");
  }
  function np(t, e) {
    return e = ep(e), ep(t) === e;
  }
  function Ht(t, e, l, i, o, s) {
    switch (l) {
      case "children":
        typeof i == "string" ? e === "body" || e === "textarea" && i === "" || Yl(t, i) : (typeof i == "number" || typeof i == "bigint") && e !== "body" && Yl(t, "" + i);
        break;
      case "className":
        ja(t, "class", i);
        break;
      case "tabIndex":
        ja(t, "tabindex", i);
        break;
      case "dir":
      case "role":
      case "viewBox":
      case "width":
      case "height":
        ja(t, l, i);
        break;
      case "style":
        ef(t, i, s);
        break;
      case "data":
        if (e !== "object") {
          ja(t, "data", i);
          break;
        }
      case "src":
      case "href":
        if (i === "" && (e !== "a" || l !== "href")) {
          t.removeAttribute(l);
          break;
        }
        if (i == null || typeof i == "function" || typeof i == "symbol" || typeof i == "boolean") {
          t.removeAttribute(l);
          break;
        }
        i = Ia("" + i), t.setAttribute(l, i);
        break;
      case "action":
      case "formAction":
        if (typeof i == "function") {
          t.setAttribute(
            l,
            "javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')"
          );
          break;
        } else
          typeof s == "function" && (l === "formAction" ? (e !== "input" && Ht(t, e, "name", o.name, o, null), Ht(
            t,
            e,
            "formEncType",
            o.formEncType,
            o,
            null
          ), Ht(
            t,
            e,
            "formMethod",
            o.formMethod,
            o,
            null
          ), Ht(
            t,
            e,
            "formTarget",
            o.formTarget,
            o,
            null
          )) : (Ht(t, e, "encType", o.encType, o, null), Ht(t, e, "method", o.method, o, null), Ht(t, e, "target", o.target, o, null)));
        if (i == null || typeof i == "symbol" || typeof i == "boolean") {
          t.removeAttribute(l);
          break;
        }
        i = Ia("" + i), t.setAttribute(l, i);
        break;
      case "onClick":
        i != null && (t.onclick = gn);
        break;
      case "onScroll":
        i != null && At("scroll", t);
        break;
      case "onScrollEnd":
        i != null && At("scrollend", t);
        break;
      case "dangerouslySetInnerHTML":
        if (i != null) {
          if (typeof i != "object" || !("__html" in i))
            throw Error(r(61));
          if (l = i.__html, l != null) {
            if (o.children != null) throw Error(r(60));
            t.innerHTML = l;
          }
        }
        break;
      case "multiple":
        t.multiple = i && typeof i != "function" && typeof i != "symbol";
        break;
      case "muted":
        t.muted = i && typeof i != "function" && typeof i != "symbol";
        break;
      case "suppressContentEditableWarning":
      case "suppressHydrationWarning":
      case "defaultValue":
      case "defaultChecked":
      case "innerHTML":
      case "ref":
        break;
      case "autoFocus":
        break;
      case "xlinkHref":
        if (i == null || typeof i == "function" || typeof i == "boolean" || typeof i == "symbol") {
          t.removeAttribute("xlink:href");
          break;
        }
        l = Ia("" + i), t.setAttributeNS(
          "http://www.w3.org/1999/xlink",
          "xlink:href",
          l
        );
        break;
      case "contentEditable":
      case "spellCheck":
      case "draggable":
      case "value":
      case "autoReverse":
      case "externalResourcesRequired":
      case "focusable":
      case "preserveAlpha":
        i != null && typeof i != "function" && typeof i != "symbol" ? t.setAttribute(l, "" + i) : t.removeAttribute(l);
        break;
      case "inert":
      case "allowFullScreen":
      case "async":
      case "autoPlay":
      case "controls":
      case "default":
      case "defer":
      case "disabled":
      case "disablePictureInPicture":
      case "disableRemotePlayback":
      case "formNoValidate":
      case "hidden":
      case "loop":
      case "noModule":
      case "noValidate":
      case "open":
      case "playsInline":
      case "readOnly":
      case "required":
      case "reversed":
      case "scoped":
      case "seamless":
      case "itemScope":
        i && typeof i != "function" && typeof i != "symbol" ? t.setAttribute(l, "") : t.removeAttribute(l);
        break;
      case "capture":
      case "download":
        i === !0 ? t.setAttribute(l, "") : i !== !1 && i != null && typeof i != "function" && typeof i != "symbol" ? t.setAttribute(l, i) : t.removeAttribute(l);
        break;
      case "cols":
      case "rows":
      case "size":
      case "span":
        i != null && typeof i != "function" && typeof i != "symbol" && !isNaN(i) && 1 <= i ? t.setAttribute(l, i) : t.removeAttribute(l);
        break;
      case "rowSpan":
      case "start":
        i == null || typeof i == "function" || typeof i == "symbol" || isNaN(i) ? t.removeAttribute(l) : t.setAttribute(l, i);
        break;
      case "popover":
        At("beforetoggle", t), At("toggle", t), Ha(t, "popover", i);
        break;
      case "xlinkActuate":
        mn(
          t,
          "http://www.w3.org/1999/xlink",
          "xlink:actuate",
          i
        );
        break;
      case "xlinkArcrole":
        mn(
          t,
          "http://www.w3.org/1999/xlink",
          "xlink:arcrole",
          i
        );
        break;
      case "xlinkRole":
        mn(
          t,
          "http://www.w3.org/1999/xlink",
          "xlink:role",
          i
        );
        break;
      case "xlinkShow":
        mn(
          t,
          "http://www.w3.org/1999/xlink",
          "xlink:show",
          i
        );
        break;
      case "xlinkTitle":
        mn(
          t,
          "http://www.w3.org/1999/xlink",
          "xlink:title",
          i
        );
        break;
      case "xlinkType":
        mn(
          t,
          "http://www.w3.org/1999/xlink",
          "xlink:type",
          i
        );
        break;
      case "xmlBase":
        mn(
          t,
          "http://www.w3.org/XML/1998/namespace",
          "xml:base",
          i
        );
        break;
      case "xmlLang":
        mn(
          t,
          "http://www.w3.org/XML/1998/namespace",
          "xml:lang",
          i
        );
        break;
      case "xmlSpace":
        mn(
          t,
          "http://www.w3.org/XML/1998/namespace",
          "xml:space",
          i
        );
        break;
      case "is":
        Ha(t, "is", i);
        break;
      case "innerText":
      case "textContent":
        break;
      default:
        (!(2 < l.length) || l[0] !== "o" && l[0] !== "O" || l[1] !== "n" && l[1] !== "N") && (l = ty.get(l) || l, Ha(t, l, i));
    }
  }
  function pc(t, e, l, i, o, s) {
    switch (l) {
      case "style":
        ef(t, i, s);
        break;
      case "dangerouslySetInnerHTML":
        if (i != null) {
          if (typeof i != "object" || !("__html" in i))
            throw Error(r(61));
          if (l = i.__html, l != null) {
            if (o.children != null) throw Error(r(60));
            t.innerHTML = l;
          }
        }
        break;
      case "children":
        typeof i == "string" ? Yl(t, i) : (typeof i == "number" || typeof i == "bigint") && Yl(t, "" + i);
        break;
      case "onScroll":
        i != null && At("scroll", t);
        break;
      case "onScrollEnd":
        i != null && At("scrollend", t);
        break;
      case "onClick":
        i != null && (t.onclick = gn);
        break;
      case "suppressContentEditableWarning":
      case "suppressHydrationWarning":
      case "innerHTML":
      case "ref":
        break;
      case "innerText":
      case "textContent":
        break;
      default:
        if (!Xs.hasOwnProperty(l))
          t: {
            if (l[0] === "o" && l[1] === "n" && (o = l.endsWith("Capture"), e = l.slice(2, o ? l.length - 7 : void 0), s = t[Ce] || null, s = s != null ? s[l] : null, typeof s == "function" && t.removeEventListener(e, s, o), typeof i == "function")) {
              typeof s != "function" && s !== null && (l in t ? t[l] = null : t.hasAttribute(l) && t.removeAttribute(l)), t.addEventListener(e, i, o);
              break t;
            }
            l in t ? t[l] = i : i === !0 ? t.setAttribute(l, "") : Ha(t, l, i);
          }
    }
  }
  function me(t, e, l) {
    switch (e) {
      case "div":
      case "span":
      case "svg":
      case "path":
      case "a":
      case "g":
      case "p":
      case "li":
        break;
      case "img":
        At("error", t), At("load", t);
        var i = !1, o = !1, s;
        for (s in l)
          if (l.hasOwnProperty(s)) {
            var g = l[s];
            if (g != null)
              switch (s) {
                case "src":
                  i = !0;
                  break;
                case "srcSet":
                  o = !0;
                  break;
                case "children":
                case "dangerouslySetInnerHTML":
                  throw Error(r(137, e));
                default:
                  Ht(t, e, s, g, l, null);
              }
          }
        o && Ht(t, e, "srcSet", l.srcSet, l, null), i && Ht(t, e, "src", l.src, l, null);
        return;
      case "input":
        At("invalid", t);
        var S = s = g = o = null, C = null, R = null;
        for (i in l)
          if (l.hasOwnProperty(i)) {
            var V = l[i];
            if (V != null)
              switch (i) {
                case "name":
                  o = V;
                  break;
                case "type":
                  g = V;
                  break;
                case "checked":
                  C = V;
                  break;
                case "defaultChecked":
                  R = V;
                  break;
                case "value":
                  s = V;
                  break;
                case "defaultValue":
                  S = V;
                  break;
                case "children":
                case "dangerouslySetInnerHTML":
                  if (V != null)
                    throw Error(r(137, e));
                  break;
                default:
                  Ht(t, e, i, V, l, null);
              }
          }
        $s(
          t,
          s,
          S,
          C,
          R,
          g,
          o,
          !1
        );
        return;
      case "select":
        At("invalid", t), i = g = s = null;
        for (o in l)
          if (l.hasOwnProperty(o) && (S = l[o], S != null))
            switch (o) {
              case "value":
                s = S;
                break;
              case "defaultValue":
                g = S;
                break;
              case "multiple":
                i = S;
              default:
                Ht(t, e, o, S, l, null);
            }
        e = s, l = g, t.multiple = !!i, e != null ? Vl(t, !!i, e, !1) : l != null && Vl(t, !!i, l, !0);
        return;
      case "textarea":
        At("invalid", t), s = o = i = null;
        for (g in l)
          if (l.hasOwnProperty(g) && (S = l[g], S != null))
            switch (g) {
              case "value":
                i = S;
                break;
              case "defaultValue":
                o = S;
                break;
              case "children":
                s = S;
                break;
              case "dangerouslySetInnerHTML":
                if (S != null) throw Error(r(91));
                break;
              default:
                Ht(t, e, g, S, l, null);
            }
        Ps(t, i, o, s);
        return;
      case "option":
        for (C in l)
          if (l.hasOwnProperty(C) && (i = l[C], i != null))
            switch (C) {
              case "selected":
                t.selected = i && typeof i != "function" && typeof i != "symbol";
                break;
              default:
                Ht(t, e, C, i, l, null);
            }
        return;
      case "dialog":
        At("beforetoggle", t), At("toggle", t), At("cancel", t), At("close", t);
        break;
      case "iframe":
      case "object":
        At("load", t);
        break;
      case "video":
      case "audio":
        for (i = 0; i < sa.length; i++)
          At(sa[i], t);
        break;
      case "image":
        At("error", t), At("load", t);
        break;
      case "details":
        At("toggle", t);
        break;
      case "embed":
      case "source":
      case "link":
        At("error", t), At("load", t);
      case "area":
      case "base":
      case "br":
      case "col":
      case "hr":
      case "keygen":
      case "meta":
      case "param":
      case "track":
      case "wbr":
      case "menuitem":
        for (R in l)
          if (l.hasOwnProperty(R) && (i = l[R], i != null))
            switch (R) {
              case "children":
              case "dangerouslySetInnerHTML":
                throw Error(r(137, e));
              default:
                Ht(t, e, R, i, l, null);
            }
        return;
      default:
        if (kr(e)) {
          for (V in l)
            l.hasOwnProperty(V) && (i = l[V], i !== void 0 && pc(
              t,
              e,
              V,
              i,
              l,
              void 0
            ));
          return;
        }
    }
    for (S in l)
      l.hasOwnProperty(S) && (i = l[S], i != null && Ht(t, e, S, i, l, null));
  }
  function k1(t, e, l, i) {
    switch (e) {
      case "div":
      case "span":
      case "svg":
      case "path":
      case "a":
      case "g":
      case "p":
      case "li":
        break;
      case "input":
        var o = null, s = null, g = null, S = null, C = null, R = null, V = null;
        for (L in l) {
          var Q = l[L];
          if (l.hasOwnProperty(L) && Q != null)
            switch (L) {
              case "checked":
                break;
              case "value":
                break;
              case "defaultValue":
                C = Q;
              default:
                i.hasOwnProperty(L) || Ht(t, e, L, null, i, Q);
            }
        }
        for (var M in i) {
          var L = i[M];
          if (Q = l[M], i.hasOwnProperty(M) && (L != null || Q != null))
            switch (M) {
              case "type":
                s = L;
                break;
              case "name":
                o = L;
                break;
              case "checked":
                R = L;
                break;
              case "defaultChecked":
                V = L;
                break;
              case "value":
                g = L;
                break;
              case "defaultValue":
                S = L;
                break;
              case "children":
              case "dangerouslySetInnerHTML":
                if (L != null)
                  throw Error(r(137, e));
                break;
              default:
                L !== Q && Ht(
                  t,
                  e,
                  M,
                  L,
                  i,
                  Q
                );
            }
        }
        Cr(
          t,
          g,
          S,
          C,
          R,
          V,
          s,
          o
        );
        return;
      case "select":
        L = g = S = M = null;
        for (s in l)
          if (C = l[s], l.hasOwnProperty(s) && C != null)
            switch (s) {
              case "value":
                break;
              case "multiple":
                L = C;
              default:
                i.hasOwnProperty(s) || Ht(
                  t,
                  e,
                  s,
                  null,
                  i,
                  C
                );
            }
        for (o in i)
          if (s = i[o], C = l[o], i.hasOwnProperty(o) && (s != null || C != null))
            switch (o) {
              case "value":
                M = s;
                break;
              case "defaultValue":
                S = s;
                break;
              case "multiple":
                g = s;
              default:
                s !== C && Ht(
                  t,
                  e,
                  o,
                  s,
                  i,
                  C
                );
            }
        e = S, l = g, i = L, M != null ? Vl(t, !!l, M, !1) : !!i != !!l && (e != null ? Vl(t, !!l, e, !0) : Vl(t, !!l, l ? [] : "", !1));
        return;
      case "textarea":
        L = M = null;
        for (S in l)
          if (o = l[S], l.hasOwnProperty(S) && o != null && !i.hasOwnProperty(S))
            switch (S) {
              case "value":
                break;
              case "children":
                break;
              default:
                Ht(t, e, S, null, i, o);
            }
        for (g in i)
          if (o = i[g], s = l[g], i.hasOwnProperty(g) && (o != null || s != null))
            switch (g) {
              case "value":
                M = o;
                break;
              case "defaultValue":
                L = o;
                break;
              case "children":
                break;
              case "dangerouslySetInnerHTML":
                if (o != null) throw Error(r(91));
                break;
              default:
                o !== s && Ht(t, e, g, o, i, s);
            }
        Ws(t, M, L);
        return;
      case "option":
        for (var lt in l)
          if (M = l[lt], l.hasOwnProperty(lt) && M != null && !i.hasOwnProperty(lt))
            switch (lt) {
              case "selected":
                t.selected = !1;
                break;
              default:
                Ht(
                  t,
                  e,
                  lt,
                  null,
                  i,
                  M
                );
            }
        for (C in i)
          if (M = i[C], L = l[C], i.hasOwnProperty(C) && M !== L && (M != null || L != null))
            switch (C) {
              case "selected":
                t.selected = M && typeof M != "function" && typeof M != "symbol";
                break;
              default:
                Ht(
                  t,
                  e,
                  C,
                  M,
                  i,
                  L
                );
            }
        return;
      case "img":
      case "link":
      case "area":
      case "base":
      case "br":
      case "col":
      case "embed":
      case "hr":
      case "keygen":
      case "meta":
      case "param":
      case "source":
      case "track":
      case "wbr":
      case "menuitem":
        for (var st in l)
          M = l[st], l.hasOwnProperty(st) && M != null && !i.hasOwnProperty(st) && Ht(t, e, st, null, i, M);
        for (R in i)
          if (M = i[R], L = l[R], i.hasOwnProperty(R) && M !== L && (M != null || L != null))
            switch (R) {
              case "children":
              case "dangerouslySetInnerHTML":
                if (M != null)
                  throw Error(r(137, e));
                break;
              default:
                Ht(
                  t,
                  e,
                  R,
                  M,
                  i,
                  L
                );
            }
        return;
      default:
        if (kr(e)) {
          for (var jt in l)
            M = l[jt], l.hasOwnProperty(jt) && M !== void 0 && !i.hasOwnProperty(jt) && pc(
              t,
              e,
              jt,
              void 0,
              i,
              M
            );
          for (V in i)
            M = i[V], L = l[V], !i.hasOwnProperty(V) || M === L || M === void 0 && L === void 0 || pc(
              t,
              e,
              V,
              M,
              i,
              L
            );
          return;
        }
    }
    for (var D in l)
      M = l[D], l.hasOwnProperty(D) && M != null && !i.hasOwnProperty(D) && Ht(t, e, D, null, i, M);
    for (Q in i)
      M = i[Q], L = l[Q], !i.hasOwnProperty(Q) || M === L || M == null && L == null || Ht(t, e, Q, M, i, L);
  }
  function lp(t) {
    switch (t) {
      case "css":
      case "script":
      case "font":
      case "img":
      case "image":
      case "input":
      case "link":
        return !0;
      default:
        return !1;
    }
  }
  function z1() {
    if (typeof performance.getEntriesByType == "function") {
      for (var t = 0, e = 0, l = performance.getEntriesByType("resource"), i = 0; i < l.length; i++) {
        var o = l[i], s = o.transferSize, g = o.initiatorType, S = o.duration;
        if (s && S && lp(g)) {
          for (g = 0, S = o.responseEnd, i += 1; i < l.length; i++) {
            var C = l[i], R = C.startTime;
            if (R > S) break;
            var V = C.transferSize, Q = C.initiatorType;
            V && lp(Q) && (C = C.responseEnd, g += V * (C < S ? 1 : (S - R) / (C - R)));
          }
          if (--i, e += 8 * (s + g) / (o.duration / 1e3), t++, 10 < t) break;
        }
      }
      if (0 < t) return e / t / 1e6;
    }
    return navigator.connection && (t = navigator.connection.downlink, typeof t == "number") ? t : 5;
  }
  var mc = null, gc = null;
  function Lu(t) {
    return t.nodeType === 9 ? t : t.ownerDocument;
  }
  function ip(t) {
    switch (t) {
      case "http://www.w3.org/2000/svg":
        return 1;
      case "http://www.w3.org/1998/Math/MathML":
        return 2;
      default:
        return 0;
    }
  }
  function ap(t, e) {
    if (t === 0)
      switch (e) {
        case "svg":
          return 1;
        case "math":
          return 2;
        default:
          return 0;
      }
    return t === 1 && e === "foreignObject" ? 0 : t;
  }
  function yc(t, e) {
    return t === "textarea" || t === "noscript" || typeof e.children == "string" || typeof e.children == "number" || typeof e.children == "bigint" || typeof e.dangerouslySetInnerHTML == "object" && e.dangerouslySetInnerHTML !== null && e.dangerouslySetInnerHTML.__html != null;
  }
  var bc = null;
  function w1() {
    var t = window.event;
    return t && t.type === "popstate" ? t === bc ? !1 : (bc = t, !0) : (bc = null, !1);
  }
  var up = typeof setTimeout == "function" ? setTimeout : void 0, D1 = typeof clearTimeout == "function" ? clearTimeout : void 0, rp = typeof Promise == "function" ? Promise : void 0, O1 = typeof queueMicrotask == "function" ? queueMicrotask : typeof rp < "u" ? function(t) {
    return rp.resolve(null).then(t).catch(N1);
  } : up;
  function N1(t) {
    setTimeout(function() {
      throw t;
    });
  }
  function tl(t) {
    return t === "head";
  }
  function op(t, e) {
    var l = e, i = 0;
    do {
      var o = l.nextSibling;
      if (t.removeChild(l), o && o.nodeType === 8)
        if (l = o.data, l === "/$" || l === "/&") {
          if (i === 0) {
            t.removeChild(o), Si(e);
            return;
          }
          i--;
        } else if (l === "$" || l === "$?" || l === "$~" || l === "$!" || l === "&")
          i++;
        else if (l === "html")
          ha(t.ownerDocument.documentElement);
        else if (l === "head") {
          l = t.ownerDocument.head, ha(l);
          for (var s = l.firstChild; s; ) {
            var g = s.nextSibling, S = s.nodeName;
            s[Di] || S === "SCRIPT" || S === "STYLE" || S === "LINK" && s.rel.toLowerCase() === "stylesheet" || l.removeChild(s), s = g;
          }
        } else
          l === "body" && ha(t.ownerDocument.body);
      l = o;
    } while (l);
    Si(e);
  }
  function cp(t, e) {
    var l = t;
    t = 0;
    do {
      var i = l.nextSibling;
      if (l.nodeType === 1 ? e ? (l._stashedDisplay = l.style.display, l.style.display = "none") : (l.style.display = l._stashedDisplay || "", l.getAttribute("style") === "" && l.removeAttribute("style")) : l.nodeType === 3 && (e ? (l._stashedText = l.nodeValue, l.nodeValue = "") : l.nodeValue = l._stashedText || ""), i && i.nodeType === 8)
        if (l = i.data, l === "/$") {
          if (t === 0) break;
          t--;
        } else
          l !== "$" && l !== "$?" && l !== "$~" && l !== "$!" || t++;
      l = i;
    } while (l);
  }
  function vc(t) {
    var e = t.firstChild;
    for (e && e.nodeType === 10 && (e = e.nextSibling); e; ) {
      var l = e;
      switch (e = e.nextSibling, l.nodeName) {
        case "HTML":
        case "HEAD":
        case "BODY":
          vc(l), Tr(l);
          continue;
        case "SCRIPT":
        case "STYLE":
          continue;
        case "LINK":
          if (l.rel.toLowerCase() === "stylesheet") continue;
      }
      t.removeChild(l);
    }
  }
  function R1(t, e, l, i) {
    for (; t.nodeType === 1; ) {
      var o = l;
      if (t.nodeName.toLowerCase() !== e.toLowerCase()) {
        if (!i && (t.nodeName !== "INPUT" || t.type !== "hidden"))
          break;
      } else if (i) {
        if (!t[Di])
          switch (e) {
            case "meta":
              if (!t.hasAttribute("itemprop")) break;
              return t;
            case "link":
              if (s = t.getAttribute("rel"), s === "stylesheet" && t.hasAttribute("data-precedence"))
                break;
              if (s !== o.rel || t.getAttribute("href") !== (o.href == null || o.href === "" ? null : o.href) || t.getAttribute("crossorigin") !== (o.crossOrigin == null ? null : o.crossOrigin) || t.getAttribute("title") !== (o.title == null ? null : o.title))
                break;
              return t;
            case "style":
              if (t.hasAttribute("data-precedence")) break;
              return t;
            case "script":
              if (s = t.getAttribute("src"), (s !== (o.src == null ? null : o.src) || t.getAttribute("type") !== (o.type == null ? null : o.type) || t.getAttribute("crossorigin") !== (o.crossOrigin == null ? null : o.crossOrigin)) && s && t.hasAttribute("async") && !t.hasAttribute("itemprop"))
                break;
              return t;
            default:
              return t;
          }
      } else if (e === "input" && t.type === "hidden") {
        var s = o.name == null ? null : "" + o.name;
        if (o.type === "hidden" && t.getAttribute("name") === s)
          return t;
      } else return t;
      if (t = Fe(t.nextSibling), t === null) break;
    }
    return null;
  }
  function M1(t, e, l) {
    if (e === "") return null;
    for (; t.nodeType !== 3; )
      if ((t.nodeType !== 1 || t.nodeName !== "INPUT" || t.type !== "hidden") && !l || (t = Fe(t.nextSibling), t === null)) return null;
    return t;
  }
  function sp(t, e) {
    for (; t.nodeType !== 8; )
      if ((t.nodeType !== 1 || t.nodeName !== "INPUT" || t.type !== "hidden") && !e || (t = Fe(t.nextSibling), t === null)) return null;
    return t;
  }
  function Sc(t) {
    return t.data === "$?" || t.data === "$~";
  }
  function Ec(t) {
    return t.data === "$!" || t.data === "$?" && t.ownerDocument.readyState !== "loading";
  }
  function U1(t, e) {
    var l = t.ownerDocument;
    if (t.data === "$~") t._reactRetry = e;
    else if (t.data !== "$?" || l.readyState !== "loading")
      e();
    else {
      var i = function() {
        e(), l.removeEventListener("DOMContentLoaded", i);
      };
      l.addEventListener("DOMContentLoaded", i), t._reactRetry = i;
    }
  }
  function Fe(t) {
    for (; t != null; t = t.nextSibling) {
      var e = t.nodeType;
      if (e === 1 || e === 3) break;
      if (e === 8) {
        if (e = t.data, e === "$" || e === "$!" || e === "$?" || e === "$~" || e === "&" || e === "F!" || e === "F")
          break;
        if (e === "/$" || e === "/&") return null;
      }
    }
    return t;
  }
  var xc = null;
  function fp(t) {
    t = t.nextSibling;
    for (var e = 0; t; ) {
      if (t.nodeType === 8) {
        var l = t.data;
        if (l === "/$" || l === "/&") {
          if (e === 0)
            return Fe(t.nextSibling);
          e--;
        } else
          l !== "$" && l !== "$!" && l !== "$?" && l !== "$~" && l !== "&" || e++;
      }
      t = t.nextSibling;
    }
    return null;
  }
  function hp(t) {
    t = t.previousSibling;
    for (var e = 0; t; ) {
      if (t.nodeType === 8) {
        var l = t.data;
        if (l === "$" || l === "$!" || l === "$?" || l === "$~" || l === "&") {
          if (e === 0) return t;
          e--;
        } else l !== "/$" && l !== "/&" || e++;
      }
      t = t.previousSibling;
    }
    return null;
  }
  function dp(t, e, l) {
    switch (e = Lu(l), t) {
      case "html":
        if (t = e.documentElement, !t) throw Error(r(452));
        return t;
      case "head":
        if (t = e.head, !t) throw Error(r(453));
        return t;
      case "body":
        if (t = e.body, !t) throw Error(r(454));
        return t;
      default:
        throw Error(r(451));
    }
  }
  function ha(t) {
    for (var e = t.attributes; e.length; )
      t.removeAttributeNode(e[0]);
    Tr(t);
  }
  var $e = /* @__PURE__ */ new Map(), pp = /* @__PURE__ */ new Set();
  function Bu(t) {
    return typeof t.getRootNode == "function" ? t.getRootNode() : t.nodeType === 9 ? t : t.ownerDocument;
  }
  var Nn = I.d;
  I.d = {
    f: L1,
    r: B1,
    D: H1,
    C: j1,
    L: q1,
    m: I1,
    X: Y1,
    S: V1,
    M: G1
  };
  function L1() {
    var t = Nn.f(), e = zu();
    return t || e;
  }
  function B1(t) {
    var e = jl(t);
    e !== null && e.tag === 5 && e.type === "form" ? Oh(e) : Nn.r(t);
  }
  var yi = typeof document > "u" ? null : document;
  function mp(t, e, l) {
    var i = yi;
    if (i && typeof e == "string" && e) {
      var o = Ye(e);
      o = 'link[rel="' + t + '"][href="' + o + '"]', typeof l == "string" && (o += '[crossorigin="' + l + '"]'), pp.has(o) || (pp.add(o), t = { rel: t, crossOrigin: l, href: e }, i.querySelector(o) === null && (e = i.createElement("link"), me(e, "link", t), ce(e), i.head.appendChild(e)));
    }
  }
  function H1(t) {
    Nn.D(t), mp("dns-prefetch", t, null);
  }
  function j1(t, e) {
    Nn.C(t, e), mp("preconnect", t, e);
  }
  function q1(t, e, l) {
    Nn.L(t, e, l);
    var i = yi;
    if (i && t && e) {
      var o = 'link[rel="preload"][as="' + Ye(e) + '"]';
      e === "image" && l && l.imageSrcSet ? (o += '[imagesrcset="' + Ye(
        l.imageSrcSet
      ) + '"]', typeof l.imageSizes == "string" && (o += '[imagesizes="' + Ye(
        l.imageSizes
      ) + '"]')) : o += '[href="' + Ye(t) + '"]';
      var s = o;
      switch (e) {
        case "style":
          s = bi(t);
          break;
        case "script":
          s = vi(t);
      }
      $e.has(s) || (t = b(
        {
          rel: "preload",
          href: e === "image" && l && l.imageSrcSet ? void 0 : t,
          as: e
        },
        l
      ), $e.set(s, t), i.querySelector(o) !== null || e === "style" && i.querySelector(da(s)) || e === "script" && i.querySelector(pa(s)) || (e = i.createElement("link"), me(e, "link", t), ce(e), i.head.appendChild(e)));
    }
  }
  function I1(t, e) {
    Nn.m(t, e);
    var l = yi;
    if (l && t) {
      var i = e && typeof e.as == "string" ? e.as : "script", o = 'link[rel="modulepreload"][as="' + Ye(i) + '"][href="' + Ye(t) + '"]', s = o;
      switch (i) {
        case "audioworklet":
        case "paintworklet":
        case "serviceworker":
        case "sharedworker":
        case "worker":
        case "script":
          s = vi(t);
      }
      if (!$e.has(s) && (t = b({ rel: "modulepreload", href: t }, e), $e.set(s, t), l.querySelector(o) === null)) {
        switch (i) {
          case "audioworklet":
          case "paintworklet":
          case "serviceworker":
          case "sharedworker":
          case "worker":
          case "script":
            if (l.querySelector(pa(s)))
              return;
        }
        i = l.createElement("link"), me(i, "link", t), ce(i), l.head.appendChild(i);
      }
    }
  }
  function V1(t, e, l) {
    Nn.S(t, e, l);
    var i = yi;
    if (i && t) {
      var o = ql(i).hoistableStyles, s = bi(t);
      e = e || "default";
      var g = o.get(s);
      if (!g) {
        var S = { loading: 0, preload: null };
        if (g = i.querySelector(
          da(s)
        ))
          S.loading = 5;
        else {
          t = b(
            { rel: "stylesheet", href: t, "data-precedence": e },
            l
          ), (l = $e.get(s)) && Tc(t, l);
          var C = g = i.createElement("link");
          ce(C), me(C, "link", t), C._p = new Promise(function(R, V) {
            C.onload = R, C.onerror = V;
          }), C.addEventListener("load", function() {
            S.loading |= 1;
          }), C.addEventListener("error", function() {
            S.loading |= 2;
          }), S.loading |= 4, Hu(g, e, i);
        }
        g = {
          type: "stylesheet",
          instance: g,
          count: 1,
          state: S
        }, o.set(s, g);
      }
    }
  }
  function Y1(t, e) {
    Nn.X(t, e);
    var l = yi;
    if (l && t) {
      var i = ql(l).hoistableScripts, o = vi(t), s = i.get(o);
      s || (s = l.querySelector(pa(o)), s || (t = b({ src: t, async: !0 }, e), (e = $e.get(o)) && Ac(t, e), s = l.createElement("script"), ce(s), me(s, "link", t), l.head.appendChild(s)), s = {
        type: "script",
        instance: s,
        count: 1,
        state: null
      }, i.set(o, s));
    }
  }
  function G1(t, e) {
    Nn.M(t, e);
    var l = yi;
    if (l && t) {
      var i = ql(l).hoistableScripts, o = vi(t), s = i.get(o);
      s || (s = l.querySelector(pa(o)), s || (t = b({ src: t, async: !0, type: "module" }, e), (e = $e.get(o)) && Ac(t, e), s = l.createElement("script"), ce(s), me(s, "link", t), l.head.appendChild(s)), s = {
        type: "script",
        instance: s,
        count: 1,
        state: null
      }, i.set(o, s));
    }
  }
  function gp(t, e, l, i) {
    var o = (o = ut.current) ? Bu(o) : null;
    if (!o) throw Error(r(446));
    switch (t) {
      case "meta":
      case "title":
        return null;
      case "style":
        return typeof l.precedence == "string" && typeof l.href == "string" ? (e = bi(l.href), l = ql(
          o
        ).hoistableStyles, i = l.get(e), i || (i = {
          type: "style",
          instance: null,
          count: 0,
          state: null
        }, l.set(e, i)), i) : { type: "void", instance: null, count: 0, state: null };
      case "link":
        if (l.rel === "stylesheet" && typeof l.href == "string" && typeof l.precedence == "string") {
          t = bi(l.href);
          var s = ql(
            o
          ).hoistableStyles, g = s.get(t);
          if (g || (o = o.ownerDocument || o, g = {
            type: "stylesheet",
            instance: null,
            count: 0,
            state: { loading: 0, preload: null }
          }, s.set(t, g), (s = o.querySelector(
            da(t)
          )) && !s._p && (g.instance = s, g.state.loading = 5), $e.has(t) || (l = {
            rel: "preload",
            as: "style",
            href: l.href,
            crossOrigin: l.crossOrigin,
            integrity: l.integrity,
            media: l.media,
            hrefLang: l.hrefLang,
            referrerPolicy: l.referrerPolicy
          }, $e.set(t, l), s || Q1(
            o,
            t,
            l,
            g.state
          ))), e && i === null)
            throw Error(r(528, ""));
          return g;
        }
        if (e && i !== null)
          throw Error(r(529, ""));
        return null;
      case "script":
        return e = l.async, l = l.src, typeof l == "string" && e && typeof e != "function" && typeof e != "symbol" ? (e = vi(l), l = ql(
          o
        ).hoistableScripts, i = l.get(e), i || (i = {
          type: "script",
          instance: null,
          count: 0,
          state: null
        }, l.set(e, i)), i) : { type: "void", instance: null, count: 0, state: null };
      default:
        throw Error(r(444, t));
    }
  }
  function bi(t) {
    return 'href="' + Ye(t) + '"';
  }
  function da(t) {
    return 'link[rel="stylesheet"][' + t + "]";
  }
  function yp(t) {
    return b({}, t, {
      "data-precedence": t.precedence,
      precedence: null
    });
  }
  function Q1(t, e, l, i) {
    t.querySelector('link[rel="preload"][as="style"][' + e + "]") ? i.loading = 1 : (e = t.createElement("link"), i.preload = e, e.addEventListener("load", function() {
      return i.loading |= 1;
    }), e.addEventListener("error", function() {
      return i.loading |= 2;
    }), me(e, "link", l), ce(e), t.head.appendChild(e));
  }
  function vi(t) {
    return '[src="' + Ye(t) + '"]';
  }
  function pa(t) {
    return "script[async]" + t;
  }
  function bp(t, e, l) {
    if (e.count++, e.instance === null)
      switch (e.type) {
        case "style":
          var i = t.querySelector(
            'style[data-href~="' + Ye(l.href) + '"]'
          );
          if (i)
            return e.instance = i, ce(i), i;
          var o = b({}, l, {
            "data-href": l.href,
            "data-precedence": l.precedence,
            href: null,
            precedence: null
          });
          return i = (t.ownerDocument || t).createElement(
            "style"
          ), ce(i), me(i, "style", o), Hu(i, l.precedence, t), e.instance = i;
        case "stylesheet":
          o = bi(l.href);
          var s = t.querySelector(
            da(o)
          );
          if (s)
            return e.state.loading |= 4, e.instance = s, ce(s), s;
          i = yp(l), (o = $e.get(o)) && Tc(i, o), s = (t.ownerDocument || t).createElement("link"), ce(s);
          var g = s;
          return g._p = new Promise(function(S, C) {
            g.onload = S, g.onerror = C;
          }), me(s, "link", i), e.state.loading |= 4, Hu(s, l.precedence, t), e.instance = s;
        case "script":
          return s = vi(l.src), (o = t.querySelector(
            pa(s)
          )) ? (e.instance = o, ce(o), o) : (i = l, (o = $e.get(s)) && (i = b({}, l), Ac(i, o)), t = t.ownerDocument || t, o = t.createElement("script"), ce(o), me(o, "link", i), t.head.appendChild(o), e.instance = o);
        case "void":
          return null;
        default:
          throw Error(r(443, e.type));
      }
    else
      e.type === "stylesheet" && (e.state.loading & 4) === 0 && (i = e.instance, e.state.loading |= 4, Hu(i, l.precedence, t));
    return e.instance;
  }
  function Hu(t, e, l) {
    for (var i = l.querySelectorAll(
      'link[rel="stylesheet"][data-precedence],style[data-precedence]'
    ), o = i.length ? i[i.length - 1] : null, s = o, g = 0; g < i.length; g++) {
      var S = i[g];
      if (S.dataset.precedence === e) s = S;
      else if (s !== o) break;
    }
    s ? s.parentNode.insertBefore(t, s.nextSibling) : (e = l.nodeType === 9 ? l.head : l, e.insertBefore(t, e.firstChild));
  }
  function Tc(t, e) {
    t.crossOrigin == null && (t.crossOrigin = e.crossOrigin), t.referrerPolicy == null && (t.referrerPolicy = e.referrerPolicy), t.title == null && (t.title = e.title);
  }
  function Ac(t, e) {
    t.crossOrigin == null && (t.crossOrigin = e.crossOrigin), t.referrerPolicy == null && (t.referrerPolicy = e.referrerPolicy), t.integrity == null && (t.integrity = e.integrity);
  }
  var ju = null;
  function vp(t, e, l) {
    if (ju === null) {
      var i = /* @__PURE__ */ new Map(), o = ju = /* @__PURE__ */ new Map();
      o.set(l, i);
    } else
      o = ju, i = o.get(l), i || (i = /* @__PURE__ */ new Map(), o.set(l, i));
    if (i.has(t)) return i;
    for (i.set(t, null), l = l.getElementsByTagName(t), o = 0; o < l.length; o++) {
      var s = l[o];
      if (!(s[Di] || s[fe] || t === "link" && s.getAttribute("rel") === "stylesheet") && s.namespaceURI !== "http://www.w3.org/2000/svg") {
        var g = s.getAttribute(e) || "";
        g = t + g;
        var S = i.get(g);
        S ? S.push(s) : i.set(g, [s]);
      }
    }
    return i;
  }
  function Sp(t, e, l) {
    t = t.ownerDocument || t, t.head.insertBefore(
      l,
      e === "title" ? t.querySelector("head > title") : null
    );
  }
  function X1(t, e, l) {
    if (l === 1 || e.itemProp != null) return !1;
    switch (t) {
      case "meta":
      case "title":
        return !0;
      case "style":
        if (typeof e.precedence != "string" || typeof e.href != "string" || e.href === "")
          break;
        return !0;
      case "link":
        if (typeof e.rel != "string" || typeof e.href != "string" || e.href === "" || e.onLoad || e.onError)
          break;
        switch (e.rel) {
          case "stylesheet":
            return t = e.disabled, typeof e.precedence == "string" && t == null;
          default:
            return !0;
        }
      case "script":
        if (e.async && typeof e.async != "function" && typeof e.async != "symbol" && !e.onLoad && !e.onError && e.src && typeof e.src == "string")
          return !0;
    }
    return !1;
  }
  function Ep(t) {
    return !(t.type === "stylesheet" && (t.state.loading & 3) === 0);
  }
  function Z1(t, e, l, i) {
    if (l.type === "stylesheet" && (typeof i.media != "string" || matchMedia(i.media).matches !== !1) && (l.state.loading & 4) === 0) {
      if (l.instance === null) {
        var o = bi(i.href), s = e.querySelector(
          da(o)
        );
        if (s) {
          e = s._p, e !== null && typeof e == "object" && typeof e.then == "function" && (t.count++, t = qu.bind(t), e.then(t, t)), l.state.loading |= 4, l.instance = s, ce(s);
          return;
        }
        s = e.ownerDocument || e, i = yp(i), (o = $e.get(o)) && Tc(i, o), s = s.createElement("link"), ce(s);
        var g = s;
        g._p = new Promise(function(S, C) {
          g.onload = S, g.onerror = C;
        }), me(s, "link", i), l.instance = s;
      }
      t.stylesheets === null && (t.stylesheets = /* @__PURE__ */ new Map()), t.stylesheets.set(l, e), (e = l.state.preload) && (l.state.loading & 3) === 0 && (t.count++, l = qu.bind(t), e.addEventListener("load", l), e.addEventListener("error", l));
    }
  }
  var Cc = 0;
  function K1(t, e) {
    return t.stylesheets && t.count === 0 && Vu(t, t.stylesheets), 0 < t.count || 0 < t.imgCount ? function(l) {
      var i = setTimeout(function() {
        if (t.stylesheets && Vu(t, t.stylesheets), t.unsuspend) {
          var s = t.unsuspend;
          t.unsuspend = null, s();
        }
      }, 6e4 + e);
      0 < t.imgBytes && Cc === 0 && (Cc = 62500 * z1());
      var o = setTimeout(
        function() {
          if (t.waitingForImages = !1, t.count === 0 && (t.stylesheets && Vu(t, t.stylesheets), t.unsuspend)) {
            var s = t.unsuspend;
            t.unsuspend = null, s();
          }
        },
        (t.imgBytes > Cc ? 50 : 800) + e
      );
      return t.unsuspend = l, function() {
        t.unsuspend = null, clearTimeout(i), clearTimeout(o);
      };
    } : null;
  }
  function qu() {
    if (this.count--, this.count === 0 && (this.imgCount === 0 || !this.waitingForImages)) {
      if (this.stylesheets) Vu(this, this.stylesheets);
      else if (this.unsuspend) {
        var t = this.unsuspend;
        this.unsuspend = null, t();
      }
    }
  }
  var Iu = null;
  function Vu(t, e) {
    t.stylesheets = null, t.unsuspend !== null && (t.count++, Iu = /* @__PURE__ */ new Map(), e.forEach(J1, t), Iu = null, qu.call(t));
  }
  function J1(t, e) {
    if (!(e.state.loading & 4)) {
      var l = Iu.get(t);
      if (l) var i = l.get(null);
      else {
        l = /* @__PURE__ */ new Map(), Iu.set(t, l);
        for (var o = t.querySelectorAll(
          "link[data-precedence],style[data-precedence]"
        ), s = 0; s < o.length; s++) {
          var g = o[s];
          (g.nodeName === "LINK" || g.getAttribute("media") !== "not all") && (l.set(g.dataset.precedence, g), i = g);
        }
        i && l.set(null, i);
      }
      o = e.instance, g = o.getAttribute("data-precedence"), s = l.get(g) || i, s === i && l.set(null, o), l.set(g, o), this.count++, i = qu.bind(this), o.addEventListener("load", i), o.addEventListener("error", i), s ? s.parentNode.insertBefore(o, s.nextSibling) : (t = t.nodeType === 9 ? t.head : t, t.insertBefore(o, t.firstChild)), e.state.loading |= 4;
    }
  }
  var ma = {
    $$typeof: U,
    Provider: null,
    Consumer: null,
    _currentValue: et,
    _currentValue2: et,
    _threadCount: 0
  };
  function F1(t, e, l, i, o, s, g, S, C) {
    this.tag = 1, this.containerInfo = t, this.pingCache = this.current = this.pendingChildren = null, this.timeoutHandle = -1, this.callbackNode = this.next = this.pendingContext = this.context = this.cancelPendingCommit = null, this.callbackPriority = 0, this.expirationTimes = vr(-1), this.entangledLanes = this.shellSuspendCounter = this.errorRecoveryDisabledLanes = this.expiredLanes = this.warmLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0, this.entanglements = vr(0), this.hiddenUpdates = vr(null), this.identifierPrefix = i, this.onUncaughtError = o, this.onCaughtError = s, this.onRecoverableError = g, this.pooledCache = null, this.pooledCacheLanes = 0, this.formState = C, this.incompleteTransitions = /* @__PURE__ */ new Map();
  }
  function xp(t, e, l, i, o, s, g, S, C, R, V, Q) {
    return t = new F1(
      t,
      e,
      l,
      g,
      C,
      R,
      V,
      Q,
      S
    ), e = 1, s === !0 && (e |= 24), s = Ue(3, null, null, e), t.current = s, s.stateNode = t, e = lo(), e.refCount++, t.pooledCache = e, e.refCount++, s.memoizedState = {
      element: i,
      isDehydrated: l,
      cache: e
    }, ro(s), t;
  }
  function Tp(t) {
    return t ? (t = Fl, t) : Fl;
  }
  function Ap(t, e, l, i, o, s) {
    o = Tp(o), i.context === null ? i.context = o : i.pendingContext = o, i = Yn(e), i.payload = { element: l }, s = s === void 0 ? null : s, s !== null && (i.callback = s), l = Gn(t, i, e), l !== null && (Oe(l, t, e), Zi(l, t, e));
  }
  function Cp(t, e) {
    if (t = t.memoizedState, t !== null && t.dehydrated !== null) {
      var l = t.retryLane;
      t.retryLane = l !== 0 && l < e ? l : e;
    }
  }
  function _c(t, e) {
    Cp(t, e), (t = t.alternate) && Cp(t, e);
  }
  function _p(t) {
    if (t.tag === 13 || t.tag === 31) {
      var e = ml(t, 67108864);
      e !== null && Oe(e, t, 67108864), _c(t, 67108864);
    }
  }
  function kp(t) {
    if (t.tag === 13 || t.tag === 31) {
      var e = qe();
      e = Sr(e);
      var l = ml(t, e);
      l !== null && Oe(l, t, e), _c(t, e);
    }
  }
  var Yu = !0;
  function $1(t, e, l, i) {
    var o = O.T;
    O.T = null;
    var s = I.p;
    try {
      I.p = 2, kc(t, e, l, i);
    } finally {
      I.p = s, O.T = o;
    }
  }
  function W1(t, e, l, i) {
    var o = O.T;
    O.T = null;
    var s = I.p;
    try {
      I.p = 8, kc(t, e, l, i);
    } finally {
      I.p = s, O.T = o;
    }
  }
  function kc(t, e, l, i) {
    if (Yu) {
      var o = zc(i);
      if (o === null)
        dc(
          t,
          e,
          i,
          Gu,
          l
        ), wp(t, i);
      else if (t0(
        o,
        t,
        e,
        l,
        i
      ))
        i.stopPropagation();
      else if (wp(t, i), e & 4 && -1 < P1.indexOf(t)) {
        for (; o !== null; ) {
          var s = jl(o);
          if (s !== null)
            switch (s.tag) {
              case 3:
                if (s = s.stateNode, s.current.memoizedState.isDehydrated) {
                  var g = sl(s.pendingLanes);
                  if (g !== 0) {
                    var S = s;
                    for (S.pendingLanes |= 2, S.entangledLanes |= 2; g; ) {
                      var C = 1 << 31 - ue(g);
                      S.entanglements[1] |= C, g &= ~C;
                    }
                    fn(s), (Rt & 6) === 0 && (_u = Ee() + 500, ca(0));
                  }
                }
                break;
              case 31:
              case 13:
                S = ml(s, 2), S !== null && Oe(S, s, 2), zu(), _c(s, 2);
            }
          if (s = zc(i), s === null && dc(
            t,
            e,
            i,
            Gu,
            l
          ), s === o) break;
          o = s;
        }
        o !== null && i.stopPropagation();
      } else
        dc(
          t,
          e,
          i,
          null,
          l
        );
    }
  }
  function zc(t) {
    return t = wr(t), wc(t);
  }
  var Gu = null;
  function wc(t) {
    if (Gu = null, t = Hl(t), t !== null) {
      var e = h(t);
      if (e === null) t = null;
      else {
        var l = e.tag;
        if (l === 13) {
          if (t = f(e), t !== null) return t;
          t = null;
        } else if (l === 31) {
          if (t = d(e), t !== null) return t;
          t = null;
        } else if (l === 3) {
          if (e.stateNode.current.memoizedState.isDehydrated)
            return e.tag === 3 ? e.stateNode.containerInfo : null;
          t = null;
        } else e !== t && (t = null);
      }
    }
    return Gu = t, null;
  }
  function zp(t) {
    switch (t) {
      case "beforetoggle":
      case "cancel":
      case "click":
      case "close":
      case "contextmenu":
      case "copy":
      case "cut":
      case "auxclick":
      case "dblclick":
      case "dragend":
      case "dragstart":
      case "drop":
      case "focusin":
      case "focusout":
      case "input":
      case "invalid":
      case "keydown":
      case "keypress":
      case "keyup":
      case "mousedown":
      case "mouseup":
      case "paste":
      case "pause":
      case "play":
      case "pointercancel":
      case "pointerdown":
      case "pointerup":
      case "ratechange":
      case "reset":
      case "resize":
      case "seeked":
      case "submit":
      case "toggle":
      case "touchcancel":
      case "touchend":
      case "touchstart":
      case "volumechange":
      case "change":
      case "selectionchange":
      case "textInput":
      case "compositionstart":
      case "compositionend":
      case "compositionupdate":
      case "beforeblur":
      case "afterblur":
      case "beforeinput":
      case "blur":
      case "fullscreenchange":
      case "focus":
      case "hashchange":
      case "popstate":
      case "select":
      case "selectstart":
        return 2;
      case "drag":
      case "dragenter":
      case "dragexit":
      case "dragleave":
      case "dragover":
      case "mousemove":
      case "mouseout":
      case "mouseover":
      case "pointermove":
      case "pointerout":
      case "pointerover":
      case "scroll":
      case "touchmove":
      case "wheel":
      case "mouseenter":
      case "mouseleave":
      case "pointerenter":
      case "pointerleave":
        return 8;
      case "message":
        switch (br()) {
          case Ua:
            return 2;
          case j:
            return 8;
          case K:
          case dt:
            return 32;
          case gt:
            return 268435456;
          default:
            return 32;
        }
      default:
        return 32;
    }
  }
  var Dc = !1, el = null, nl = null, ll = null, ga = /* @__PURE__ */ new Map(), ya = /* @__PURE__ */ new Map(), il = [], P1 = "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset".split(
    " "
  );
  function wp(t, e) {
    switch (t) {
      case "focusin":
      case "focusout":
        el = null;
        break;
      case "dragenter":
      case "dragleave":
        nl = null;
        break;
      case "mouseover":
      case "mouseout":
        ll = null;
        break;
      case "pointerover":
      case "pointerout":
        ga.delete(e.pointerId);
        break;
      case "gotpointercapture":
      case "lostpointercapture":
        ya.delete(e.pointerId);
    }
  }
  function ba(t, e, l, i, o, s) {
    return t === null || t.nativeEvent !== s ? (t = {
      blockedOn: e,
      domEventName: l,
      eventSystemFlags: i,
      nativeEvent: s,
      targetContainers: [o]
    }, e !== null && (e = jl(e), e !== null && _p(e)), t) : (t.eventSystemFlags |= i, e = t.targetContainers, o !== null && e.indexOf(o) === -1 && e.push(o), t);
  }
  function t0(t, e, l, i, o) {
    switch (e) {
      case "focusin":
        return el = ba(
          el,
          t,
          e,
          l,
          i,
          o
        ), !0;
      case "dragenter":
        return nl = ba(
          nl,
          t,
          e,
          l,
          i,
          o
        ), !0;
      case "mouseover":
        return ll = ba(
          ll,
          t,
          e,
          l,
          i,
          o
        ), !0;
      case "pointerover":
        var s = o.pointerId;
        return ga.set(
          s,
          ba(
            ga.get(s) || null,
            t,
            e,
            l,
            i,
            o
          )
        ), !0;
      case "gotpointercapture":
        return s = o.pointerId, ya.set(
          s,
          ba(
            ya.get(s) || null,
            t,
            e,
            l,
            i,
            o
          )
        ), !0;
    }
    return !1;
  }
  function Dp(t) {
    var e = Hl(t.target);
    if (e !== null) {
      var l = h(e);
      if (l !== null) {
        if (e = l.tag, e === 13) {
          if (e = f(l), e !== null) {
            t.blockedOn = e, Ys(t.priority, function() {
              kp(l);
            });
            return;
          }
        } else if (e === 31) {
          if (e = d(l), e !== null) {
            t.blockedOn = e, Ys(t.priority, function() {
              kp(l);
            });
            return;
          }
        } else if (e === 3 && l.stateNode.current.memoizedState.isDehydrated) {
          t.blockedOn = l.tag === 3 ? l.stateNode.containerInfo : null;
          return;
        }
      }
    }
    t.blockedOn = null;
  }
  function Qu(t) {
    if (t.blockedOn !== null) return !1;
    for (var e = t.targetContainers; 0 < e.length; ) {
      var l = zc(t.nativeEvent);
      if (l === null) {
        l = t.nativeEvent;
        var i = new l.constructor(
          l.type,
          l
        );
        zr = i, l.target.dispatchEvent(i), zr = null;
      } else
        return e = jl(l), e !== null && _p(e), t.blockedOn = l, !1;
      e.shift();
    }
    return !0;
  }
  function Op(t, e, l) {
    Qu(t) && l.delete(e);
  }
  function e0() {
    Dc = !1, el !== null && Qu(el) && (el = null), nl !== null && Qu(nl) && (nl = null), ll !== null && Qu(ll) && (ll = null), ga.forEach(Op), ya.forEach(Op);
  }
  function Xu(t, e) {
    t.blockedOn === e && (t.blockedOn = null, Dc || (Dc = !0, n.unstable_scheduleCallback(
      n.unstable_NormalPriority,
      e0
    )));
  }
  var Zu = null;
  function Np(t) {
    Zu !== t && (Zu = t, n.unstable_scheduleCallback(
      n.unstable_NormalPriority,
      function() {
        Zu === t && (Zu = null);
        for (var e = 0; e < t.length; e += 3) {
          var l = t[e], i = t[e + 1], o = t[e + 2];
          if (typeof i != "function") {
            if (wc(i || l) === null)
              continue;
            break;
          }
          var s = jl(l);
          s !== null && (t.splice(e, 3), e -= 3, zo(
            s,
            {
              pending: !0,
              data: o,
              method: l.method,
              action: i
            },
            i,
            o
          ));
        }
      }
    ));
  }
  function Si(t) {
    function e(C) {
      return Xu(C, t);
    }
    el !== null && Xu(el, t), nl !== null && Xu(nl, t), ll !== null && Xu(ll, t), ga.forEach(e), ya.forEach(e);
    for (var l = 0; l < il.length; l++) {
      var i = il[l];
      i.blockedOn === t && (i.blockedOn = null);
    }
    for (; 0 < il.length && (l = il[0], l.blockedOn === null); )
      Dp(l), l.blockedOn === null && il.shift();
    if (l = (t.ownerDocument || t).$$reactFormReplay, l != null)
      for (i = 0; i < l.length; i += 3) {
        var o = l[i], s = l[i + 1], g = o[Ce] || null;
        if (typeof s == "function")
          g || Np(l);
        else if (g) {
          var S = null;
          if (s && s.hasAttribute("formAction")) {
            if (o = s, g = s[Ce] || null)
              S = g.formAction;
            else if (wc(o) !== null) continue;
          } else S = g.action;
          typeof S == "function" ? l[i + 1] = S : (l.splice(i, 3), i -= 3), Np(l);
        }
      }
  }
  function Rp() {
    function t(s) {
      s.canIntercept && s.info === "react-transition" && s.intercept({
        handler: function() {
          return new Promise(function(g) {
            return o = g;
          });
        },
        focusReset: "manual",
        scroll: "manual"
      });
    }
    function e() {
      o !== null && (o(), o = null), i || setTimeout(l, 20);
    }
    function l() {
      if (!i && !navigation.transition) {
        var s = navigation.currentEntry;
        s && s.url != null && navigation.navigate(s.url, {
          state: s.getState(),
          info: "react-transition",
          history: "replace"
        });
      }
    }
    if (typeof navigation == "object") {
      var i = !1, o = null;
      return navigation.addEventListener("navigate", t), navigation.addEventListener("navigatesuccess", e), navigation.addEventListener("navigateerror", e), setTimeout(l, 100), function() {
        i = !0, navigation.removeEventListener("navigate", t), navigation.removeEventListener("navigatesuccess", e), navigation.removeEventListener("navigateerror", e), o !== null && (o(), o = null);
      };
    }
  }
  function Oc(t) {
    this._internalRoot = t;
  }
  Ku.prototype.render = Oc.prototype.render = function(t) {
    var e = this._internalRoot;
    if (e === null) throw Error(r(409));
    var l = e.current, i = qe();
    Ap(l, i, t, e, null, null);
  }, Ku.prototype.unmount = Oc.prototype.unmount = function() {
    var t = this._internalRoot;
    if (t !== null) {
      this._internalRoot = null;
      var e = t.containerInfo;
      Ap(t.current, 2, null, t, null, null), zu(), e[Bl] = null;
    }
  };
  function Ku(t) {
    this._internalRoot = t;
  }
  Ku.prototype.unstable_scheduleHydration = function(t) {
    if (t) {
      var e = Vs();
      t = { blockedOn: null, target: t, priority: e };
      for (var l = 0; l < il.length && e !== 0 && e < il[l].priority; l++) ;
      il.splice(l, 0, t), l === 0 && Dp(t);
    }
  };
  var Mp = a.version;
  if (Mp !== "19.2.0")
    throw Error(
      r(
        527,
        Mp,
        "19.2.0"
      )
    );
  I.findDOMNode = function(t) {
    var e = t._reactInternals;
    if (e === void 0)
      throw typeof t.render == "function" ? Error(r(188)) : (t = Object.keys(t).join(","), Error(r(268, t)));
    return t = p(e), t = t !== null ? y(t) : null, t = t === null ? null : t.stateNode, t;
  };
  var n0 = {
    bundleType: 0,
    version: "19.2.0",
    rendererPackageName: "react-dom",
    currentDispatcherRef: O,
    reconcilerVersion: "19.2.0"
  };
  if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u") {
    var Ju = __REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!Ju.isDisabled && Ju.supportsFiber)
      try {
        te = Ju.inject(
          n0
        ), Xt = Ju;
      } catch {
      }
  }
  return Sa.createRoot = function(t, e) {
    if (!c(t)) throw Error(r(299));
    var l = !1, i = "", o = Ih, s = Vh, g = Yh;
    return e != null && (e.unstable_strictMode === !0 && (l = !0), e.identifierPrefix !== void 0 && (i = e.identifierPrefix), e.onUncaughtError !== void 0 && (o = e.onUncaughtError), e.onCaughtError !== void 0 && (s = e.onCaughtError), e.onRecoverableError !== void 0 && (g = e.onRecoverableError)), e = xp(
      t,
      1,
      !1,
      null,
      null,
      l,
      i,
      null,
      o,
      s,
      g,
      Rp
    ), t[Bl] = e.current, hc(t), new Oc(e);
  }, Sa.hydrateRoot = function(t, e, l) {
    if (!c(t)) throw Error(r(299));
    var i = !1, o = "", s = Ih, g = Vh, S = Yh, C = null;
    return l != null && (l.unstable_strictMode === !0 && (i = !0), l.identifierPrefix !== void 0 && (o = l.identifierPrefix), l.onUncaughtError !== void 0 && (s = l.onUncaughtError), l.onCaughtError !== void 0 && (g = l.onCaughtError), l.onRecoverableError !== void 0 && (S = l.onRecoverableError), l.formState !== void 0 && (C = l.formState)), e = xp(
      t,
      1,
      !0,
      e,
      l ?? null,
      i,
      o,
      C,
      s,
      g,
      S,
      Rp
    ), e.context = Tp(null), l = e.current, i = qe(), i = Sr(i), o = Yn(i), o.callback = null, Gn(l, o, i), l = i, e.current.lanes = l, wi(e, l), fn(e), t[Bl] = e.current, hc(t), new Ku(e);
  }, Sa.version = "19.2.0", Sa;
}
var Gp;
function d0() {
  if (Gp) return Rc.exports;
  Gp = 1;
  function n() {
    if (!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function"))
      try {
        __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n);
      } catch (a) {
        console.error(a);
      }
  }
  return n(), Rc.exports = h0(), Rc.exports;
}
var p0 = d0(), Rn = ys();
function m0(n, a) {
  const u = {};
  return (n[n.length - 1] === "" ? [...n, ""] : n).join(
    (u.padRight ? " " : "") + "," + (u.padLeft === !1 ? "" : " ")
  ).trim();
}
const g0 = /^[$_\p{ID_Start}][$_\u{200C}\u{200D}\p{ID_Continue}]*$/u, y0 = /^[$_\p{ID_Start}][-$_\u{200C}\u{200D}\p{ID_Continue}]*$/u, b0 = {};
function Qp(n, a) {
  return (b0.jsx ? y0 : g0).test(n);
}
const v0 = /[ \t\n\f\r]/g;
function S0(n) {
  return typeof n == "object" ? n.type === "text" ? Xp(n.value) : !1 : Xp(n);
}
function Xp(n) {
  return n.replace(v0, "") === "";
}
class Oa {
  /**
   * @param {SchemaType['property']} property
   *   Property.
   * @param {SchemaType['normal']} normal
   *   Normal.
   * @param {Space | undefined} [space]
   *   Space.
   * @returns
   *   Schema.
   */
  constructor(a, u, r) {
    this.normal = u, this.property = a, r && (this.space = r);
  }
}
Oa.prototype.normal = {};
Oa.prototype.property = {};
Oa.prototype.space = void 0;
function Lm(n, a) {
  const u = {}, r = {};
  for (const c of n)
    Object.assign(u, c.property), Object.assign(r, c.normal);
  return new Oa(u, r, a);
}
function ts(n) {
  return n.toLowerCase();
}
class Re {
  /**
   * @param {string} property
   *   Property.
   * @param {string} attribute
   *   Attribute.
   * @returns
   *   Info.
   */
  constructor(a, u) {
    this.attribute = u, this.property = a;
  }
}
Re.prototype.attribute = "";
Re.prototype.booleanish = !1;
Re.prototype.boolean = !1;
Re.prototype.commaOrSpaceSeparated = !1;
Re.prototype.commaSeparated = !1;
Re.prototype.defined = !1;
Re.prototype.mustUseProperty = !1;
Re.prototype.number = !1;
Re.prototype.overloadedBoolean = !1;
Re.prototype.property = "";
Re.prototype.spaceSeparated = !1;
Re.prototype.space = void 0;
let E0 = 0;
const pt = Rl(), ae = Rl(), es = Rl(), Z = Rl(), Vt = Rl(), Dl = Rl(), Ie = Rl();
function Rl() {
  return 2 ** ++E0;
}
const ns = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  boolean: pt,
  booleanish: ae,
  commaOrSpaceSeparated: Ie,
  commaSeparated: Dl,
  number: Z,
  overloadedBoolean: es,
  spaceSeparated: Vt
}, Symbol.toStringTag, { value: "Module" })), Hc = (
  /** @type {ReadonlyArray<keyof typeof types>} */
  Object.keys(ns)
);
class bs extends Re {
  /**
   * @constructor
   * @param {string} property
   *   Property.
   * @param {string} attribute
   *   Attribute.
   * @param {number | null | undefined} [mask]
   *   Mask.
   * @param {Space | undefined} [space]
   *   Space.
   * @returns
   *   Info.
   */
  constructor(a, u, r, c) {
    let h = -1;
    if (super(a, u), Zp(this, "space", c), typeof r == "number")
      for (; ++h < Hc.length; ) {
        const f = Hc[h];
        Zp(this, Hc[h], (r & ns[f]) === ns[f]);
      }
  }
}
bs.prototype.defined = !0;
function Zp(n, a, u) {
  u && (n[a] = u);
}
function Ti(n) {
  const a = {}, u = {};
  for (const [r, c] of Object.entries(n.properties)) {
    const h = new bs(
      r,
      n.transform(n.attributes || {}, r),
      c,
      n.space
    );
    n.mustUseProperty && n.mustUseProperty.includes(r) && (h.mustUseProperty = !0), a[r] = h, u[ts(r)] = r, u[ts(h.attribute)] = r;
  }
  return new Oa(a, u, n.space);
}
const Bm = Ti({
  properties: {
    ariaActiveDescendant: null,
    ariaAtomic: ae,
    ariaAutoComplete: null,
    ariaBusy: ae,
    ariaChecked: ae,
    ariaColCount: Z,
    ariaColIndex: Z,
    ariaColSpan: Z,
    ariaControls: Vt,
    ariaCurrent: null,
    ariaDescribedBy: Vt,
    ariaDetails: null,
    ariaDisabled: ae,
    ariaDropEffect: Vt,
    ariaErrorMessage: null,
    ariaExpanded: ae,
    ariaFlowTo: Vt,
    ariaGrabbed: ae,
    ariaHasPopup: null,
    ariaHidden: ae,
    ariaInvalid: null,
    ariaKeyShortcuts: null,
    ariaLabel: null,
    ariaLabelledBy: Vt,
    ariaLevel: Z,
    ariaLive: null,
    ariaModal: ae,
    ariaMultiLine: ae,
    ariaMultiSelectable: ae,
    ariaOrientation: null,
    ariaOwns: Vt,
    ariaPlaceholder: null,
    ariaPosInSet: Z,
    ariaPressed: ae,
    ariaReadOnly: ae,
    ariaRelevant: null,
    ariaRequired: ae,
    ariaRoleDescription: Vt,
    ariaRowCount: Z,
    ariaRowIndex: Z,
    ariaRowSpan: Z,
    ariaSelected: ae,
    ariaSetSize: Z,
    ariaSort: null,
    ariaValueMax: Z,
    ariaValueMin: Z,
    ariaValueNow: Z,
    ariaValueText: null,
    role: null
  },
  transform(n, a) {
    return a === "role" ? a : "aria-" + a.slice(4).toLowerCase();
  }
});
function Hm(n, a) {
  return a in n ? n[a] : a;
}
function jm(n, a) {
  return Hm(n, a.toLowerCase());
}
const x0 = Ti({
  attributes: {
    acceptcharset: "accept-charset",
    classname: "class",
    htmlfor: "for",
    httpequiv: "http-equiv"
  },
  mustUseProperty: ["checked", "multiple", "muted", "selected"],
  properties: {
    // Standard Properties.
    abbr: null,
    accept: Dl,
    acceptCharset: Vt,
    accessKey: Vt,
    action: null,
    allow: null,
    allowFullScreen: pt,
    allowPaymentRequest: pt,
    allowUserMedia: pt,
    alpha: pt,
    alt: null,
    as: null,
    async: pt,
    autoCapitalize: null,
    autoComplete: Vt,
    autoFocus: pt,
    autoPlay: pt,
    blocking: Vt,
    capture: null,
    charSet: null,
    checked: pt,
    cite: null,
    className: Vt,
    closedBy: null,
    colorSpace: null,
    cols: Z,
    colSpan: Z,
    command: null,
    commandFor: null,
    content: null,
    contentEditable: ae,
    controls: pt,
    controlsList: Vt,
    coords: Z | Dl,
    crossOrigin: null,
    data: null,
    dateTime: null,
    decoding: null,
    default: pt,
    defer: pt,
    dir: null,
    dirName: null,
    disabled: pt,
    download: es,
    draggable: ae,
    encType: null,
    enterKeyHint: null,
    fetchPriority: null,
    form: null,
    formAction: null,
    formEncType: null,
    formMethod: null,
    formNoValidate: pt,
    formTarget: null,
    headers: Vt,
    height: Z,
    hidden: es,
    high: Z,
    href: null,
    hrefLang: null,
    htmlFor: Vt,
    httpEquiv: Vt,
    id: null,
    imageSizes: null,
    imageSrcSet: null,
    inert: pt,
    inputMode: null,
    integrity: null,
    is: null,
    isMap: pt,
    itemId: null,
    itemProp: Vt,
    itemRef: Vt,
    itemScope: pt,
    itemType: Vt,
    kind: null,
    label: null,
    lang: null,
    language: null,
    list: null,
    loading: null,
    loop: pt,
    low: Z,
    manifest: null,
    max: null,
    maxLength: Z,
    media: null,
    method: null,
    min: null,
    minLength: Z,
    multiple: pt,
    muted: pt,
    name: null,
    nonce: null,
    noModule: pt,
    noValidate: pt,
    onAbort: null,
    onAfterPrint: null,
    onAuxClick: null,
    onBeforeMatch: null,
    onBeforePrint: null,
    onBeforeToggle: null,
    onBeforeUnload: null,
    onBlur: null,
    onCancel: null,
    onCanPlay: null,
    onCanPlayThrough: null,
    onChange: null,
    onClick: null,
    onClose: null,
    onContextLost: null,
    onContextMenu: null,
    onContextRestored: null,
    onCopy: null,
    onCueChange: null,
    onCut: null,
    onDblClick: null,
    onDrag: null,
    onDragEnd: null,
    onDragEnter: null,
    onDragExit: null,
    onDragLeave: null,
    onDragOver: null,
    onDragStart: null,
    onDrop: null,
    onDurationChange: null,
    onEmptied: null,
    onEnded: null,
    onError: null,
    onFocus: null,
    onFormData: null,
    onHashChange: null,
    onInput: null,
    onInvalid: null,
    onKeyDown: null,
    onKeyPress: null,
    onKeyUp: null,
    onLanguageChange: null,
    onLoad: null,
    onLoadedData: null,
    onLoadedMetadata: null,
    onLoadEnd: null,
    onLoadStart: null,
    onMessage: null,
    onMessageError: null,
    onMouseDown: null,
    onMouseEnter: null,
    onMouseLeave: null,
    onMouseMove: null,
    onMouseOut: null,
    onMouseOver: null,
    onMouseUp: null,
    onOffline: null,
    onOnline: null,
    onPageHide: null,
    onPageShow: null,
    onPaste: null,
    onPause: null,
    onPlay: null,
    onPlaying: null,
    onPopState: null,
    onProgress: null,
    onRateChange: null,
    onRejectionHandled: null,
    onReset: null,
    onResize: null,
    onScroll: null,
    onScrollEnd: null,
    onSecurityPolicyViolation: null,
    onSeeked: null,
    onSeeking: null,
    onSelect: null,
    onSlotChange: null,
    onStalled: null,
    onStorage: null,
    onSubmit: null,
    onSuspend: null,
    onTimeUpdate: null,
    onToggle: null,
    onUnhandledRejection: null,
    onUnload: null,
    onVolumeChange: null,
    onWaiting: null,
    onWheel: null,
    open: pt,
    optimum: Z,
    pattern: null,
    ping: Vt,
    placeholder: null,
    playsInline: pt,
    popover: null,
    popoverTarget: null,
    popoverTargetAction: null,
    poster: null,
    preload: null,
    readOnly: pt,
    referrerPolicy: null,
    rel: Vt,
    required: pt,
    reversed: pt,
    rows: Z,
    rowSpan: Z,
    sandbox: Vt,
    scope: null,
    scoped: pt,
    seamless: pt,
    selected: pt,
    shadowRootClonable: pt,
    shadowRootCustomElementRegistry: pt,
    shadowRootDelegatesFocus: pt,
    shadowRootMode: null,
    shadowRootSerializable: pt,
    shape: null,
    size: Z,
    sizes: null,
    slot: null,
    span: Z,
    spellCheck: ae,
    src: null,
    srcDoc: null,
    srcLang: null,
    srcSet: null,
    start: Z,
    step: null,
    style: null,
    tabIndex: Z,
    target: null,
    title: null,
    translate: null,
    type: null,
    typeMustMatch: pt,
    useMap: null,
    value: ae,
    width: Z,
    wrap: null,
    writingSuggestions: null,
    // Legacy.
    // See: https://html.spec.whatwg.org/#other-elements,-attributes-and-apis
    align: null,
    // Several. Use CSS `text-align` instead,
    aLink: null,
    // `<body>`. Use CSS `a:active {color}` instead
    archive: Vt,
    // `<object>`. List of URIs to archives
    axis: null,
    // `<td>` and `<th>`. Use `scope` on `<th>`
    background: null,
    // `<body>`. Use CSS `background-image` instead
    bgColor: null,
    // `<body>` and table elements. Use CSS `background-color` instead
    border: Z,
    // `<table>`. Use CSS `border-width` instead,
    borderColor: null,
    // `<table>`. Use CSS `border-color` instead,
    bottomMargin: Z,
    // `<body>`
    cellPadding: null,
    // `<table>`
    cellSpacing: null,
    // `<table>`
    char: null,
    // Several table elements. When `align=char`, sets the character to align on
    charOff: null,
    // Several table elements. When `char`, offsets the alignment
    classId: null,
    // `<object>`
    clear: null,
    // `<br>`. Use CSS `clear` instead
    code: null,
    // `<object>`
    codeBase: null,
    // `<object>`
    codeType: null,
    // `<object>`
    color: null,
    // `<font>` and `<hr>`. Use CSS instead
    compact: pt,
    // Lists. Use CSS to reduce space between items instead
    declare: pt,
    // `<object>`
    event: null,
    // `<script>`
    face: null,
    // `<font>`. Use CSS instead
    frame: null,
    // `<table>`
    frameBorder: null,
    // `<iframe>`. Use CSS `border` instead
    hSpace: Z,
    // `<img>` and `<object>`
    leftMargin: Z,
    // `<body>`
    link: null,
    // `<body>`. Use CSS `a:link {color: *}` instead
    longDesc: null,
    // `<frame>`, `<iframe>`, and `<img>`. Use an `<a>`
    lowSrc: null,
    // `<img>`. Use a `<picture>`
    marginHeight: Z,
    // `<body>`
    marginWidth: Z,
    // `<body>`
    noResize: pt,
    // `<frame>`
    noHref: pt,
    // `<area>`. Use no href instead of an explicit `nohref`
    noShade: pt,
    // `<hr>`. Use background-color and height instead of borders
    noWrap: pt,
    // `<td>` and `<th>`
    object: null,
    // `<applet>`
    profile: null,
    // `<head>`
    prompt: null,
    // `<isindex>`
    rev: null,
    // `<link>`
    rightMargin: Z,
    // `<body>`
    rules: null,
    // `<table>`
    scheme: null,
    // `<meta>`
    scrolling: ae,
    // `<frame>`. Use overflow in the child context
    standby: null,
    // `<object>`
    summary: null,
    // `<table>`
    text: null,
    // `<body>`. Use CSS `color` instead
    topMargin: Z,
    // `<body>`
    valueType: null,
    // `<param>`
    version: null,
    // `<html>`. Use a doctype.
    vAlign: null,
    // Several. Use CSS `vertical-align` instead
    vLink: null,
    // `<body>`. Use CSS `a:visited {color}` instead
    vSpace: Z,
    // `<img>` and `<object>`
    // Non-standard Properties.
    allowTransparency: null,
    autoCorrect: null,
    autoSave: null,
    credentialless: pt,
    disablePictureInPicture: pt,
    disableRemotePlayback: pt,
    exportParts: Dl,
    part: Vt,
    prefix: null,
    property: null,
    results: Z,
    security: null,
    unselectable: null
  },
  space: "html",
  transform: jm
}), T0 = Ti({
  attributes: {
    accentHeight: "accent-height",
    alignmentBaseline: "alignment-baseline",
    arabicForm: "arabic-form",
    baselineShift: "baseline-shift",
    capHeight: "cap-height",
    className: "class",
    clipPath: "clip-path",
    clipRule: "clip-rule",
    colorInterpolation: "color-interpolation",
    colorInterpolationFilters: "color-interpolation-filters",
    colorProfile: "color-profile",
    colorRendering: "color-rendering",
    crossOrigin: "crossorigin",
    dataType: "datatype",
    dominantBaseline: "dominant-baseline",
    enableBackground: "enable-background",
    fillOpacity: "fill-opacity",
    fillRule: "fill-rule",
    floodColor: "flood-color",
    floodOpacity: "flood-opacity",
    fontFamily: "font-family",
    fontSize: "font-size",
    fontSizeAdjust: "font-size-adjust",
    fontStretch: "font-stretch",
    fontStyle: "font-style",
    fontVariant: "font-variant",
    fontWeight: "font-weight",
    glyphName: "glyph-name",
    glyphOrientationHorizontal: "glyph-orientation-horizontal",
    glyphOrientationVertical: "glyph-orientation-vertical",
    hrefLang: "hreflang",
    horizAdvX: "horiz-adv-x",
    horizOriginX: "horiz-origin-x",
    horizOriginY: "horiz-origin-y",
    imageRendering: "image-rendering",
    letterSpacing: "letter-spacing",
    lightingColor: "lighting-color",
    markerEnd: "marker-end",
    markerMid: "marker-mid",
    markerStart: "marker-start",
    maskType: "mask-type",
    navDown: "nav-down",
    navDownLeft: "nav-down-left",
    navDownRight: "nav-down-right",
    navLeft: "nav-left",
    navNext: "nav-next",
    navPrev: "nav-prev",
    navRight: "nav-right",
    navUp: "nav-up",
    navUpLeft: "nav-up-left",
    navUpRight: "nav-up-right",
    onAbort: "onabort",
    onActivate: "onactivate",
    onAfterPrint: "onafterprint",
    onBeforePrint: "onbeforeprint",
    onBegin: "onbegin",
    onCancel: "oncancel",
    onCanPlay: "oncanplay",
    onCanPlayThrough: "oncanplaythrough",
    onChange: "onchange",
    onClick: "onclick",
    onClose: "onclose",
    onCopy: "oncopy",
    onCueChange: "oncuechange",
    onCut: "oncut",
    onDblClick: "ondblclick",
    onDrag: "ondrag",
    onDragEnd: "ondragend",
    onDragEnter: "ondragenter",
    onDragExit: "ondragexit",
    onDragLeave: "ondragleave",
    onDragOver: "ondragover",
    onDragStart: "ondragstart",
    onDrop: "ondrop",
    onDurationChange: "ondurationchange",
    onEmptied: "onemptied",
    onEnd: "onend",
    onEnded: "onended",
    onError: "onerror",
    onFocus: "onfocus",
    onFocusIn: "onfocusin",
    onFocusOut: "onfocusout",
    onHashChange: "onhashchange",
    onInput: "oninput",
    onInvalid: "oninvalid",
    onKeyDown: "onkeydown",
    onKeyPress: "onkeypress",
    onKeyUp: "onkeyup",
    onLoad: "onload",
    onLoadedData: "onloadeddata",
    onLoadedMetadata: "onloadedmetadata",
    onLoadStart: "onloadstart",
    onMessage: "onmessage",
    onMouseDown: "onmousedown",
    onMouseEnter: "onmouseenter",
    onMouseLeave: "onmouseleave",
    onMouseMove: "onmousemove",
    onMouseOut: "onmouseout",
    onMouseOver: "onmouseover",
    onMouseUp: "onmouseup",
    onMouseWheel: "onmousewheel",
    onOffline: "onoffline",
    onOnline: "ononline",
    onPageHide: "onpagehide",
    onPageShow: "onpageshow",
    onPaste: "onpaste",
    onPause: "onpause",
    onPlay: "onplay",
    onPlaying: "onplaying",
    onPopState: "onpopstate",
    onProgress: "onprogress",
    onRateChange: "onratechange",
    onRepeat: "onrepeat",
    onReset: "onreset",
    onResize: "onresize",
    onScroll: "onscroll",
    onSeeked: "onseeked",
    onSeeking: "onseeking",
    onSelect: "onselect",
    onShow: "onshow",
    onStalled: "onstalled",
    onStorage: "onstorage",
    onSubmit: "onsubmit",
    onSuspend: "onsuspend",
    onTimeUpdate: "ontimeupdate",
    onToggle: "ontoggle",
    onUnload: "onunload",
    onVolumeChange: "onvolumechange",
    onWaiting: "onwaiting",
    onZoom: "onzoom",
    overlinePosition: "overline-position",
    overlineThickness: "overline-thickness",
    paintOrder: "paint-order",
    panose1: "panose-1",
    pointerEvents: "pointer-events",
    referrerPolicy: "referrerpolicy",
    renderingIntent: "rendering-intent",
    shapeRendering: "shape-rendering",
    stopColor: "stop-color",
    stopOpacity: "stop-opacity",
    strikethroughPosition: "strikethrough-position",
    strikethroughThickness: "strikethrough-thickness",
    strokeDashArray: "stroke-dasharray",
    strokeDashOffset: "stroke-dashoffset",
    strokeLineCap: "stroke-linecap",
    strokeLineJoin: "stroke-linejoin",
    strokeMiterLimit: "stroke-miterlimit",
    strokeOpacity: "stroke-opacity",
    strokeWidth: "stroke-width",
    tabIndex: "tabindex",
    textAnchor: "text-anchor",
    textDecoration: "text-decoration",
    textRendering: "text-rendering",
    transformOrigin: "transform-origin",
    typeOf: "typeof",
    underlinePosition: "underline-position",
    underlineThickness: "underline-thickness",
    unicodeBidi: "unicode-bidi",
    unicodeRange: "unicode-range",
    unitsPerEm: "units-per-em",
    vAlphabetic: "v-alphabetic",
    vHanging: "v-hanging",
    vIdeographic: "v-ideographic",
    vMathematical: "v-mathematical",
    vectorEffect: "vector-effect",
    vertAdvY: "vert-adv-y",
    vertOriginX: "vert-origin-x",
    vertOriginY: "vert-origin-y",
    wordSpacing: "word-spacing",
    writingMode: "writing-mode",
    xHeight: "x-height",
    // These were camelcased in Tiny. Now lowercased in SVG 2
    playbackOrder: "playbackorder",
    timelineBegin: "timelinebegin"
  },
  properties: {
    about: Ie,
    accentHeight: Z,
    accumulate: null,
    additive: null,
    alignmentBaseline: null,
    alphabetic: Z,
    amplitude: Z,
    arabicForm: null,
    ascent: Z,
    attributeName: null,
    attributeType: null,
    azimuth: Z,
    bandwidth: null,
    baselineShift: null,
    baseFrequency: null,
    baseProfile: null,
    bbox: null,
    begin: null,
    bias: Z,
    by: null,
    calcMode: null,
    capHeight: Z,
    className: Vt,
    clip: null,
    clipPath: null,
    clipPathUnits: null,
    clipRule: null,
    color: null,
    colorInterpolation: null,
    colorInterpolationFilters: null,
    colorProfile: null,
    colorRendering: null,
    content: null,
    contentScriptType: null,
    contentStyleType: null,
    crossOrigin: null,
    cursor: null,
    cx: null,
    cy: null,
    d: null,
    dataType: null,
    defaultAction: null,
    descent: Z,
    diffuseConstant: Z,
    direction: null,
    display: null,
    dur: null,
    divisor: Z,
    dominantBaseline: null,
    download: pt,
    dx: null,
    dy: null,
    edgeMode: null,
    editable: null,
    elevation: Z,
    enableBackground: null,
    end: null,
    event: null,
    exponent: Z,
    externalResourcesRequired: null,
    fill: null,
    fillOpacity: Z,
    fillRule: null,
    filter: null,
    filterRes: null,
    filterUnits: null,
    floodColor: null,
    floodOpacity: null,
    focusable: null,
    focusHighlight: null,
    fontFamily: null,
    fontSize: null,
    fontSizeAdjust: null,
    fontStretch: null,
    fontStyle: null,
    fontVariant: null,
    fontWeight: null,
    format: null,
    fr: null,
    from: null,
    fx: null,
    fy: null,
    g1: Dl,
    g2: Dl,
    glyphName: Dl,
    glyphOrientationHorizontal: null,
    glyphOrientationVertical: null,
    glyphRef: null,
    gradientTransform: null,
    gradientUnits: null,
    handler: null,
    hanging: Z,
    hatchContentUnits: null,
    hatchUnits: null,
    height: null,
    href: null,
    hrefLang: null,
    horizAdvX: Z,
    horizOriginX: Z,
    horizOriginY: Z,
    id: null,
    ideographic: Z,
    imageRendering: null,
    initialVisibility: null,
    in: null,
    in2: null,
    intercept: Z,
    k: Z,
    k1: Z,
    k2: Z,
    k3: Z,
    k4: Z,
    kernelMatrix: Ie,
    kernelUnitLength: null,
    keyPoints: null,
    // SEMI_COLON_SEPARATED
    keySplines: null,
    // SEMI_COLON_SEPARATED
    keyTimes: null,
    // SEMI_COLON_SEPARATED
    kerning: null,
    lang: null,
    lengthAdjust: null,
    letterSpacing: null,
    lightingColor: null,
    limitingConeAngle: Z,
    local: null,
    markerEnd: null,
    markerMid: null,
    markerStart: null,
    markerHeight: null,
    markerUnits: null,
    markerWidth: null,
    mask: null,
    maskContentUnits: null,
    maskType: null,
    maskUnits: null,
    mathematical: null,
    max: null,
    media: null,
    mediaCharacterEncoding: null,
    mediaContentEncodings: null,
    mediaSize: Z,
    mediaTime: null,
    method: null,
    min: null,
    mode: null,
    name: null,
    navDown: null,
    navDownLeft: null,
    navDownRight: null,
    navLeft: null,
    navNext: null,
    navPrev: null,
    navRight: null,
    navUp: null,
    navUpLeft: null,
    navUpRight: null,
    numOctaves: null,
    observer: null,
    offset: null,
    onAbort: null,
    onActivate: null,
    onAfterPrint: null,
    onBeforePrint: null,
    onBegin: null,
    onCancel: null,
    onCanPlay: null,
    onCanPlayThrough: null,
    onChange: null,
    onClick: null,
    onClose: null,
    onCopy: null,
    onCueChange: null,
    onCut: null,
    onDblClick: null,
    onDrag: null,
    onDragEnd: null,
    onDragEnter: null,
    onDragExit: null,
    onDragLeave: null,
    onDragOver: null,
    onDragStart: null,
    onDrop: null,
    onDurationChange: null,
    onEmptied: null,
    onEnd: null,
    onEnded: null,
    onError: null,
    onFocus: null,
    onFocusIn: null,
    onFocusOut: null,
    onHashChange: null,
    onInput: null,
    onInvalid: null,
    onKeyDown: null,
    onKeyPress: null,
    onKeyUp: null,
    onLoad: null,
    onLoadedData: null,
    onLoadedMetadata: null,
    onLoadStart: null,
    onMessage: null,
    onMouseDown: null,
    onMouseEnter: null,
    onMouseLeave: null,
    onMouseMove: null,
    onMouseOut: null,
    onMouseOver: null,
    onMouseUp: null,
    onMouseWheel: null,
    onOffline: null,
    onOnline: null,
    onPageHide: null,
    onPageShow: null,
    onPaste: null,
    onPause: null,
    onPlay: null,
    onPlaying: null,
    onPopState: null,
    onProgress: null,
    onRateChange: null,
    onRepeat: null,
    onReset: null,
    onResize: null,
    onScroll: null,
    onSeeked: null,
    onSeeking: null,
    onSelect: null,
    onShow: null,
    onStalled: null,
    onStorage: null,
    onSubmit: null,
    onSuspend: null,
    onTimeUpdate: null,
    onToggle: null,
    onUnload: null,
    onVolumeChange: null,
    onWaiting: null,
    onZoom: null,
    opacity: null,
    operator: null,
    order: null,
    orient: null,
    orientation: null,
    origin: null,
    overflow: null,
    overlay: null,
    overlinePosition: Z,
    overlineThickness: Z,
    paintOrder: null,
    panose1: null,
    path: null,
    pathLength: Z,
    patternContentUnits: null,
    patternTransform: null,
    patternUnits: null,
    phase: null,
    ping: Vt,
    pitch: null,
    playbackOrder: null,
    pointerEvents: null,
    points: null,
    pointsAtX: Z,
    pointsAtY: Z,
    pointsAtZ: Z,
    preserveAlpha: null,
    preserveAspectRatio: null,
    primitiveUnits: null,
    propagate: null,
    property: Ie,
    r: null,
    radius: null,
    referrerPolicy: null,
    refX: null,
    refY: null,
    rel: Ie,
    rev: Ie,
    renderingIntent: null,
    repeatCount: null,
    repeatDur: null,
    requiredExtensions: Ie,
    requiredFeatures: Ie,
    requiredFonts: Ie,
    requiredFormats: Ie,
    resource: null,
    restart: null,
    result: null,
    rotate: null,
    rx: null,
    ry: null,
    scale: null,
    seed: null,
    shapeRendering: null,
    side: null,
    slope: null,
    snapshotTime: null,
    specularConstant: Z,
    specularExponent: Z,
    spreadMethod: null,
    spacing: null,
    startOffset: null,
    stdDeviation: null,
    stemh: null,
    stemv: null,
    stitchTiles: null,
    stopColor: null,
    stopOpacity: null,
    strikethroughPosition: Z,
    strikethroughThickness: Z,
    string: null,
    stroke: null,
    strokeDashArray: Ie,
    strokeDashOffset: null,
    strokeLineCap: null,
    strokeLineJoin: null,
    strokeMiterLimit: Z,
    strokeOpacity: Z,
    strokeWidth: null,
    style: null,
    surfaceScale: Z,
    syncBehavior: null,
    syncBehaviorDefault: null,
    syncMaster: null,
    syncTolerance: null,
    syncToleranceDefault: null,
    systemLanguage: Ie,
    tabIndex: Z,
    tableValues: null,
    target: null,
    targetX: Z,
    targetY: Z,
    textAnchor: null,
    textDecoration: null,
    textRendering: null,
    textLength: null,
    timelineBegin: null,
    title: null,
    transformBehavior: null,
    type: null,
    typeOf: Ie,
    to: null,
    transform: null,
    transformOrigin: null,
    u1: null,
    u2: null,
    underlinePosition: Z,
    underlineThickness: Z,
    unicode: null,
    unicodeBidi: null,
    unicodeRange: null,
    unitsPerEm: Z,
    values: null,
    vAlphabetic: Z,
    vMathematical: Z,
    vectorEffect: null,
    vHanging: Z,
    vIdeographic: Z,
    version: null,
    vertAdvY: Z,
    vertOriginX: Z,
    vertOriginY: Z,
    viewBox: null,
    viewTarget: null,
    visibility: null,
    width: null,
    widths: null,
    wordSpacing: null,
    writingMode: null,
    x: null,
    x1: null,
    x2: null,
    xChannelSelector: null,
    xHeight: Z,
    y: null,
    y1: null,
    y2: null,
    yChannelSelector: null,
    z: null,
    zoomAndPan: null
  },
  space: "svg",
  transform: Hm
}), qm = Ti({
  properties: {
    xLinkActuate: null,
    xLinkArcRole: null,
    xLinkHref: null,
    xLinkRole: null,
    xLinkShow: null,
    xLinkTitle: null,
    xLinkType: null
  },
  space: "xlink",
  transform(n, a) {
    return "xlink:" + a.slice(5).toLowerCase();
  }
}), Im = Ti({
  attributes: { xmlnsxlink: "xmlns:xlink" },
  properties: { xmlnsXLink: null, xmlns: null },
  space: "xmlns",
  transform: jm
}), Vm = Ti({
  properties: { xmlBase: null, xmlLang: null, xmlSpace: null },
  space: "xml",
  transform(n, a) {
    return "xml:" + a.slice(3).toLowerCase();
  }
}), A0 = {
  classId: "classID",
  dataType: "datatype",
  itemId: "itemID",
  strokeDashArray: "strokeDasharray",
  strokeDashOffset: "strokeDashoffset",
  strokeLineCap: "strokeLinecap",
  strokeLineJoin: "strokeLinejoin",
  strokeMiterLimit: "strokeMiterlimit",
  typeOf: "typeof",
  xLinkActuate: "xlinkActuate",
  xLinkArcRole: "xlinkArcrole",
  xLinkHref: "xlinkHref",
  xLinkRole: "xlinkRole",
  xLinkShow: "xlinkShow",
  xLinkTitle: "xlinkTitle",
  xLinkType: "xlinkType",
  xmlnsXLink: "xmlnsXlink"
}, C0 = /[A-Z]/g, Kp = /-[a-z]/g, _0 = /^data[-\w.:]+$/i;
function k0(n, a) {
  const u = ts(a);
  let r = a, c = Re;
  if (u in n.normal)
    return n.property[n.normal[u]];
  if (u.length > 4 && u.slice(0, 4) === "data" && _0.test(a)) {
    if (a.charAt(4) === "-") {
      const h = a.slice(5).replace(Kp, w0);
      r = "data" + h.charAt(0).toUpperCase() + h.slice(1);
    } else {
      const h = a.slice(4);
      if (!Kp.test(h)) {
        let f = h.replace(C0, z0);
        f.charAt(0) !== "-" && (f = "-" + f), a = "data" + f;
      }
    }
    c = bs;
  }
  return new c(r, a);
}
function z0(n) {
  return "-" + n.toLowerCase();
}
function w0(n) {
  return n.charAt(1).toUpperCase();
}
const D0 = Lm([Bm, x0, qm, Im, Vm], "html"), vs = Lm([Bm, T0, qm, Im, Vm], "svg");
function O0(n) {
  return n.join(" ").trim();
}
var Jp = /\/\*(?:[^*]|\*(?!\/))*\*\//g, N0 = /\n/g, R0 = /^\s*/, M0 = /^(\*?[-#/*\\\w]+(\[[0-9a-z_-]+\])?)\s*/, U0 = /^:\s*/, L0 = /^((?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|url\((?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|[^)]*)\)|[^};])+)/, B0 = /^[;\s]*/, H0 = `
`, Fp = "/", $p = "*", Ea = "", j0 = "comment", q0 = "declaration";
function I0(n, a) {
  if (typeof n != "string")
    throw new TypeError("First argument must be a string");
  if (!n) return [];
  a = a || {};
  var u = 1, r = 1;
  function c(A) {
    var w = A.match(N0);
    w && (u += w.length);
    var q = A.lastIndexOf(H0);
    r = ~q ? A.length - q : r + A.length;
  }
  function h() {
    var A = { line: u, column: r };
    return function(w) {
      return w.position = new f(A), p(), w;
    };
  }
  function f(A) {
    this.start = A, this.end = { line: u, column: r }, this.source = a.source;
  }
  f.prototype.content = n;
  function d(A) {
    var w = new Error(
      a.source + ":" + u + ":" + r + ": " + A
    );
    if (w.reason = A, w.filename = a.source, w.line = u, w.column = r, w.source = n, !a.silent) throw w;
  }
  function m(A) {
    var w = A.exec(n);
    if (w) {
      var q = w[0];
      return c(q), n = n.slice(q.length), w;
    }
  }
  function p() {
    m(R0);
  }
  function y(A) {
    for (var w; w = b(); )
      A.push(w);
    return A;
  }
  function b() {
    var A = h();
    if (!(Fp != n.charAt(0) || $p != n.charAt(1))) {
      for (var w = 2; Ea != n.charAt(w) && ($p != n.charAt(w) || Fp != n.charAt(w + 1)); )
        ++w;
      if (w += 2, Ea === n.charAt(w - 1))
        return d("End of comment missing");
      var q = n.slice(2, w - 2);
      return r += 2, c(q), n = n.slice(w), r += 2, A({
        type: j0,
        comment: q
      });
    }
  }
  function E() {
    var A = h(), w = m(M0);
    if (w) {
      if (b(), !m(U0)) return d("property missing ':'");
      var q = m(L0), z = A({
        type: q0,
        property: w[0].replace(Jp, Ea).trim(),
        value: q ? q[0].replace(Jp, Ea).trim() : Ea
      });
      return m(B0), z;
    }
  }
  function v() {
    var A = [];
    y(A);
    for (var w; w = E(); )
      A.push(w), y(A);
    return A;
  }
  return p(), v();
}
function V0(n, a) {
  let u = null;
  if (!n || typeof n != "string") return u;
  const r = I0(n), c = typeof a == "function";
  return r.forEach((h) => {
    if (h.type !== "declaration") return;
    const { property: f, value: d } = h;
    c ? a(f, d, h) : d && (u = u ?? {}, u[f] = d);
  }), u;
}
const Ym = Gm("end"), Ss = Gm("start");
function Gm(n) {
  return a;
  function a(u) {
    const r = u && u.position && u.position[n] || {};
    if (typeof r.line == "number" && r.line > 0 && typeof r.column == "number" && r.column > 0)
      return {
        line: r.line,
        column: r.column,
        offset: typeof r.offset == "number" && r.offset > -1 ? r.offset : void 0
      };
  }
}
function Y0(n) {
  const a = Ss(n), u = Ym(n);
  if (a && u)
    return { start: a, end: u };
}
function _a(n) {
  return !n || typeof n != "object" ? "" : "position" in n || "type" in n ? Wp(n.position) : "start" in n || "end" in n ? Wp(n) : "line" in n || "column" in n ? ls(n) : "";
}
function ls(n) {
  return Pp(n && n.line) + ":" + Pp(n && n.column);
}
function Wp(n) {
  return ls(n && n.start) + "-" + ls(n && n.end);
}
function Pp(n) {
  return n && typeof n == "number" ? n : 1;
}
class rr extends Error {
  /**
   * Create a message for `reason`.
   *
   * > 🪦 **Note**: also has obsolete signatures.
   *
   * @overload
   * @param {string} reason
   *   Reason for message, should use markdown.
   * @param {Options | null | undefined} [options]
   *   Configuration (optional).
   * @returns
   *   Instance of `VFileMessage`.
   *
   * @overload
   * @param {string} reason
   *   Reason for message, should use markdown.
   * @param {Node | NodeLike | null | undefined} parent
   *   Node or node-like, used for `ancestors` and `place`.
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (optional).
   * @returns
   *   Instance of `VFileMessage`.
   *
   * @overload
   * @param {string} reason
   *   Reason for message, should use markdown.
   * @param {Point | Position | null | undefined} place
   *   Place of message.
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (optional).
   * @returns
   *   Instance of `VFileMessage`.
   *
   * @overload
   * @param {string} reason
   *   Reason for message, should use markdown.
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (optional).
   * @returns
   *   Instance of `VFileMessage`.
   *
   * @overload
   * @param {Error | VFileMessage} cause
   *   Original error cause of the message.
   * @param {Node | NodeLike | null | undefined} parent
   *   Node or node-like, used for `ancestors` and `place`.
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (optional).
   * @returns
   *   Instance of `VFileMessage`.
   *
   * @overload
   * @param {Error | VFileMessage} cause
   *   Original error cause of the message.
   * @param {Point | Position | null | undefined} place
   *   Place of message.
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (optional).
   * @returns
   *   Instance of `VFileMessage`.
   *
   * @overload
   * @param {Error | VFileMessage} cause
   *   Original error cause of the message.
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (optional).
   * @returns
   *   Instance of `VFileMessage`.
   *
   * @param {Error | VFileMessage | string} causeOrReason
   *   Reason for message, should use markdown.
   * @param {Node | NodeLike | Options | Point | Position | string | null | undefined} [optionsOrParentOrPlace]
   *   Configuration (optional).
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (example:
   *   `'my-package:my-rule'` or `'my-rule'`).
   * @returns
   *   Instance of `VFileMessage`.
   */
  // eslint-disable-next-line complexity
  constructor(a, u, r) {
    super(), typeof u == "string" && (r = u, u = void 0);
    let c = "", h = {}, f = !1;
    if (u && ("line" in u && "column" in u ? h = { place: u } : "start" in u && "end" in u ? h = { place: u } : "type" in u ? h = {
      ancestors: [u],
      place: u.position
    } : h = { ...u }), typeof a == "string" ? c = a : !h.cause && a && (f = !0, c = a.message, h.cause = a), !h.ruleId && !h.source && typeof r == "string") {
      const m = r.indexOf(":");
      m === -1 ? h.ruleId = r : (h.source = r.slice(0, m), h.ruleId = r.slice(m + 1));
    }
    if (!h.place && h.ancestors) {
      const m = h.ancestors[h.ancestors.length - 1];
      m && (h.place = m.position);
    }
    const d = h.place && "start" in h.place ? h.place.start : h.place;
    this.ancestors = h.ancestors || void 0, this.cause = h.cause || void 0, this.column = d ? d.column : void 0, this.fatal = void 0, this.file = "", this.message = c, this.line = d ? d.line : void 0, this.name = _a(h.place) || "1:1", this.place = h.place || void 0, this.reason = this.message, this.ruleId = h.ruleId || void 0, this.source = h.source || void 0, this.stack = f && h.cause && typeof h.cause.stack == "string" ? h.cause.stack : "", this.actual = void 0, this.expected = void 0, this.note = void 0, this.url = void 0;
  }
}
Object.defineProperties(rr.prototype, {
  file: { configurable: !0, enumerable: !0, value: "", writable: !0 },
  name: { configurable: !0, enumerable: !0, value: "", writable: !0 },
  reason: { configurable: !0, enumerable: !0, value: "", writable: !0 },
  message: { configurable: !0, enumerable: !0, value: "", writable: !0 },
  stack: { configurable: !0, enumerable: !0, value: "", writable: !0 },
  column: { configurable: !0, enumerable: !0, writable: !0 },
  line: { configurable: !0, enumerable: !0, writable: !0 },
  ancestors: { configurable: !0, enumerable: !0, writable: !0 },
  cause: { configurable: !0, enumerable: !0, writable: !0 },
  fatal: { configurable: !0, enumerable: !0, writable: !0 },
  place: { configurable: !0, enumerable: !0, writable: !0 },
  ruleId: { configurable: !0, enumerable: !0, writable: !0 },
  source: { configurable: !0, enumerable: !0, writable: !0 }
});
const Es = {}.hasOwnProperty, G0 = /* @__PURE__ */ new Map(), Q0 = /[A-Z]/g, X0 = /-([a-z])/g, Z0 = /* @__PURE__ */ new Set(["table", "tbody", "thead", "tfoot", "tr"]), K0 = /* @__PURE__ */ new Set(["td", "th"]), Qm = "https://github.com/syntax-tree/hast-util-to-jsx-runtime";
function J0(n, a) {
  if (!a || a.Fragment === void 0)
    throw new TypeError("Expected `Fragment` in options");
  const u = a.filePath || void 0;
  let r;
  if (a.development) {
    if (typeof a.jsxDEV != "function")
      throw new TypeError(
        "Expected `jsxDEV` in options when `development: true`"
      );
    r = lb(u, a.jsxDEV);
  } else {
    if (typeof a.jsx != "function")
      throw new TypeError("Expected `jsx` in production options");
    if (typeof a.jsxs != "function")
      throw new TypeError("Expected `jsxs` in production options");
    r = nb(u, a.jsx, a.jsxs);
  }
  const c = {
    Fragment: a.Fragment,
    ancestors: [],
    components: a.components || {},
    create: r,
    elementAttributeNameCase: a.elementAttributeNameCase || "react",
    evaluater: a.createEvaluater ? a.createEvaluater() : void 0,
    filePath: u,
    ignoreInvalidStyle: a.ignoreInvalidStyle || !1,
    passKeys: a.passKeys !== !1,
    passNode: a.passNode || !1,
    schema: a.space === "svg" ? vs : D0,
    stylePropertyNameCase: a.stylePropertyNameCase || "dom",
    tableCellAlignToStyle: a.tableCellAlignToStyle !== !1
  }, h = Xm(c, n, void 0);
  return h && typeof h != "string" ? h : c.create(
    n,
    c.Fragment,
    { children: h || void 0 },
    void 0
  );
}
function Xm(n, a, u) {
  if (a.type === "element")
    return F0(n, a, u);
  if (a.type === "mdxFlowExpression" || a.type === "mdxTextExpression")
    return $0(n, a);
  if (a.type === "mdxJsxFlowElement" || a.type === "mdxJsxTextElement")
    return P0(n, a, u);
  if (a.type === "mdxjsEsm")
    return W0(n, a);
  if (a.type === "root")
    return tb(n, a, u);
  if (a.type === "text")
    return eb(n, a);
}
function F0(n, a, u) {
  const r = n.schema;
  let c = r;
  a.tagName.toLowerCase() === "svg" && r.space === "html" && (c = vs, n.schema = c), n.ancestors.push(a);
  const h = Km(n, a.tagName, !1), f = ib(n, a);
  let d = Ts(n, a);
  return Z0.has(a.tagName) && (d = d.filter(function(m) {
    return typeof m == "string" ? !S0(m) : !0;
  })), Zm(n, f, h, a), xs(f, d), n.ancestors.pop(), n.schema = r, n.create(a, h, f, u);
}
function $0(n, a) {
  if (a.data && a.data.estree && n.evaluater) {
    const r = a.data.estree.body[0];
    return r.type, /** @type {Child | undefined} */
    n.evaluater.evaluateExpression(r.expression);
  }
  Da(n, a.position);
}
function W0(n, a) {
  if (a.data && a.data.estree && n.evaluater)
    return (
      /** @type {Child | undefined} */
      n.evaluater.evaluateProgram(a.data.estree)
    );
  Da(n, a.position);
}
function P0(n, a, u) {
  const r = n.schema;
  let c = r;
  a.name === "svg" && r.space === "html" && (c = vs, n.schema = c), n.ancestors.push(a);
  const h = a.name === null ? n.Fragment : Km(n, a.name, !0), f = ab(n, a), d = Ts(n, a);
  return Zm(n, f, h, a), xs(f, d), n.ancestors.pop(), n.schema = r, n.create(a, h, f, u);
}
function tb(n, a, u) {
  const r = {};
  return xs(r, Ts(n, a)), n.create(a, n.Fragment, r, u);
}
function eb(n, a) {
  return a.value;
}
function Zm(n, a, u, r) {
  typeof u != "string" && u !== n.Fragment && n.passNode && (a.node = r);
}
function xs(n, a) {
  if (a.length > 0) {
    const u = a.length > 1 ? a : a[0];
    u && (n.children = u);
  }
}
function nb(n, a, u) {
  return r;
  function r(c, h, f, d) {
    const p = Array.isArray(f.children) ? u : a;
    return d ? p(h, f, d) : p(h, f);
  }
}
function lb(n, a) {
  return u;
  function u(r, c, h, f) {
    const d = Array.isArray(h.children), m = Ss(r);
    return a(
      c,
      h,
      f,
      d,
      {
        columnNumber: m ? m.column - 1 : void 0,
        fileName: n,
        lineNumber: m ? m.line : void 0
      },
      void 0
    );
  }
}
function ib(n, a) {
  const u = {};
  let r, c;
  for (c in a.properties)
    if (c !== "children" && Es.call(a.properties, c)) {
      const h = ub(n, c, a.properties[c]);
      if (h) {
        const [f, d] = h;
        n.tableCellAlignToStyle && f === "align" && typeof d == "string" && K0.has(a.tagName) ? r = d : u[f] = d;
      }
    }
  if (r) {
    const h = (
      /** @type {Style} */
      u.style || (u.style = {})
    );
    h[n.stylePropertyNameCase === "css" ? "text-align" : "textAlign"] = r;
  }
  return u;
}
function ab(n, a) {
  const u = {};
  for (const r of a.attributes)
    if (r.type === "mdxJsxExpressionAttribute")
      if (r.data && r.data.estree && n.evaluater) {
        const h = r.data.estree.body[0];
        h.type;
        const f = h.expression;
        f.type;
        const d = f.properties[0];
        d.type, Object.assign(
          u,
          n.evaluater.evaluateExpression(d.argument)
        );
      } else
        Da(n, a.position);
    else {
      const { name: c } = r;
      let h;
      if (r.value && typeof r.value == "object")
        if (r.value.data && r.value.data.estree && n.evaluater) {
          const d = r.value.data.estree.body[0];
          d.type, h = n.evaluater.evaluateExpression(d.expression);
        } else
          Da(n, a.position);
      else
        h = r.value === null ? !0 : r.value;
      u[c] = /** @type {Props[keyof Props]} */
      h;
    }
  return u;
}
function Ts(n, a) {
  const u = [];
  let r = -1;
  const c = n.passKeys ? /* @__PURE__ */ new Map() : G0;
  for (; ++r < a.children.length; ) {
    const h = a.children[r];
    let f;
    if (n.passKeys) {
      const m = h.type === "element" ? h.tagName : h.type === "mdxJsxFlowElement" || h.type === "mdxJsxTextElement" ? h.name : void 0;
      if (m) {
        const p = c.get(m) || 0;
        f = m + "-" + p, c.set(m, p + 1);
      }
    }
    const d = Xm(n, h, f);
    d !== void 0 && u.push(d);
  }
  return u;
}
function ub(n, a, u) {
  if (u == null || typeof u == "number" && Number.isNaN(u))
    return;
  const r = k0(n.schema, a);
  return Array.isArray(u) && (u = r.commaSeparated ? m0(u) : O0(u)), r.property === "style" ? ["style", typeof u == "object" ? n.stylePropertyNameCase === "dom" ? u : ob(u) : rb(n, String(u))] : [
    n.elementAttributeNameCase === "react" && r.space ? A0[r.property] || r.property : r.attribute,
    u
  ];
}
function rb(n, a) {
  const u = {};
  try {
    V0(a, function(r, c) {
      if (r && c) {
        let h = r;
        h.slice(0, 2) !== "--" && (h = h.toLowerCase(), n.stylePropertyNameCase === "dom" && (h.slice(0, 4) === "-ms-" && (h = h.slice(1)), h = h.replace(X0, fb))), u[h] = c;
      }
    });
  } catch (r) {
    if (n.ignoreInvalidStyle)
      return {};
    const c = (
      /** @type {Error} */
      r
    ), h = new rr("Cannot parse `style` attribute", {
      ancestors: n.ancestors,
      cause: c,
      ruleId: "style",
      source: "hast-util-to-jsx-runtime"
    });
    throw h.file = n.filePath || void 0, h.url = Qm + "#cannot-parse-style-attribute", h;
  }
  return u;
}
function Km(n, a, u) {
  let r;
  if (!u)
    r = { type: "Literal", value: a };
  else if (a.includes(".")) {
    const c = a.split(".");
    let h = -1, f;
    for (; ++h < c.length; ) {
      const d = Qp(c[h]) ? { type: "Identifier", name: c[h] } : { type: "Literal", value: c[h] };
      f = f ? {
        type: "MemberExpression",
        object: f,
        property: d,
        computed: !!(h && d.type === "Literal"),
        optional: !1
      } : d;
    }
    r = f;
  } else
    r = Qp(a) && !/^[a-z]/.test(a) ? { type: "Identifier", name: a } : { type: "Literal", value: a };
  if (r.type === "Literal") {
    const c = (
      /** @type {string | number} */
      r.value
    );
    return Es.call(n.components, c) ? n.components[c] : c;
  }
  if (n.evaluater)
    return n.evaluater.evaluateExpression(r);
  Da(n);
}
function Da(n, a) {
  const u = new rr(
    "Cannot handle MDX estrees without `createEvaluater`",
    {
      ancestors: n.ancestors,
      place: a,
      ruleId: "mdx-estree",
      source: "hast-util-to-jsx-runtime"
    }
  );
  throw u.file = n.filePath || void 0, u.url = Qm + "#cannot-handle-mdx-estrees-without-createevaluater", u;
}
function ob(n) {
  const a = {};
  let u;
  for (u in n)
    Es.call(n, u) && (a[cb(u)] = n[u]);
  return a;
}
function cb(n) {
  if (n.slice(0, 2) === "--") return n;
  let a = n.replace(Q0, sb);
  return a.slice(0, 3) === "ms-" && (a = "-" + a), a;
}
function sb(n) {
  return "-" + n.toLowerCase();
}
function fb(n, a) {
  return a.toUpperCase();
}
const jc = {
  action: ["form"],
  cite: ["blockquote", "del", "ins", "q"],
  data: ["object"],
  formAction: ["button", "input"],
  href: ["a", "area", "base", "link"],
  icon: ["menuitem"],
  itemId: null,
  manifest: ["html"],
  ping: ["a", "area"],
  poster: ["video"],
  src: [
    "audio",
    "embed",
    "iframe",
    "img",
    "input",
    "script",
    "source",
    "track",
    "video"
  ]
}, hb = {};
function or(n, a) {
  const u = hb, r = typeof u.includeImageAlt == "boolean" ? u.includeImageAlt : !0, c = typeof u.includeHtml == "boolean" ? u.includeHtml : !0;
  return Jm(n, r, c);
}
function Jm(n, a, u) {
  if (db(n)) {
    if ("value" in n)
      return n.type === "html" && !u ? "" : n.value;
    if (a && "alt" in n && n.alt)
      return n.alt;
    if ("children" in n)
      return tm(n.children, a, u);
  }
  return Array.isArray(n) ? tm(n, a, u) : "";
}
function tm(n, a, u) {
  const r = [];
  let c = -1;
  for (; ++c < n.length; )
    r[c] = Jm(n[c], a, u);
  return r.join("");
}
function db(n) {
  return !!(n && typeof n == "object");
}
const em = document.createElement("i");
function As(n) {
  const a = "&" + n + ";";
  em.innerHTML = a;
  const u = em.textContent;
  return u.charCodeAt(u.length - 1) === 59 && n !== "semi" || u === a ? !1 : u;
}
function ln(n, a, u, r) {
  const c = n.length;
  let h = 0, f;
  if (a < 0 ? a = -a > c ? 0 : c + a : a = a > c ? c : a, u = u > 0 ? u : 0, r.length < 1e4)
    f = Array.from(r), f.unshift(a, u), n.splice(...f);
  else
    for (u && n.splice(a, u); h < r.length; )
      f = r.slice(h, h + 1e4), f.unshift(a, 0), n.splice(...f), h += 1e4, a += 1e4;
}
function We(n, a) {
  return n.length > 0 ? (ln(n, n.length, 0, a), n) : a;
}
const nm = {}.hasOwnProperty;
function Fm(n) {
  const a = {};
  let u = -1;
  for (; ++u < n.length; )
    pb(a, n[u]);
  return a;
}
function pb(n, a) {
  let u;
  for (u in a) {
    const c = (nm.call(n, u) ? n[u] : void 0) || (n[u] = {}), h = a[u];
    let f;
    if (h)
      for (f in h) {
        nm.call(c, f) || (c[f] = []);
        const d = h[f];
        mb(
          // @ts-expect-error Looks like a list.
          c[f],
          Array.isArray(d) ? d : d ? [d] : []
        );
      }
  }
}
function mb(n, a) {
  let u = -1;
  const r = [];
  for (; ++u < a.length; )
    (a[u].add === "after" ? n : r).push(a[u]);
  ln(n, 0, 0, r);
}
function $m(n, a) {
  const u = Number.parseInt(n, a);
  return (
    // C0 except for HT, LF, FF, CR, space.
    u < 9 || u === 11 || u > 13 && u < 32 || // Control character (DEL) of C0, and C1 controls.
    u > 126 && u < 160 || // Lone high surrogates and low surrogates.
    u > 55295 && u < 57344 || // Noncharacters.
    u > 64975 && u < 65008 || /* eslint-disable no-bitwise */
    (u & 65535) === 65535 || (u & 65535) === 65534 || /* eslint-enable no-bitwise */
    // Out of range
    u > 1114111 ? "�" : String.fromCodePoint(u)
  );
}
function an(n) {
  return n.replace(/[\t\n\r ]+/g, " ").replace(/^ | $/g, "").toLowerCase().toUpperCase();
}
const ge = ol(/[A-Za-z]/), ye = ol(/[\dA-Za-z]/), gb = ol(/[#-'*+\--9=?A-Z^-~]/);
function nr(n) {
  return (
    // Special whitespace codes (which have negative values), C0 and Control
    // character DEL
    n !== null && (n < 32 || n === 127)
  );
}
const is = ol(/\d/), yb = ol(/[\dA-Fa-f]/), Wm = ol(/[!-/:-@[-`{-~]/);
function ft(n) {
  return n !== null && n < -2;
}
function Yt(n) {
  return n !== null && (n < 0 || n === 32);
}
function St(n) {
  return n === -2 || n === -1 || n === 32;
}
const Na = ol(/\p{P}|\p{S}/u), Nl = ol(/\s/);
function ol(n) {
  return a;
  function a(u) {
    return u !== null && u > -1 && n.test(String.fromCharCode(u));
  }
}
function Ai(n) {
  const a = [];
  let u = -1, r = 0, c = 0;
  for (; ++u < n.length; ) {
    const h = n.charCodeAt(u);
    let f = "";
    if (h === 37 && ye(n.charCodeAt(u + 1)) && ye(n.charCodeAt(u + 2)))
      c = 2;
    else if (h < 128)
      /[!#$&-;=?-Z_a-z~]/.test(String.fromCharCode(h)) || (f = String.fromCharCode(h));
    else if (h > 55295 && h < 57344) {
      const d = n.charCodeAt(u + 1);
      h < 56320 && d > 56319 && d < 57344 ? (f = String.fromCharCode(h, d), c = 1) : f = "�";
    } else
      f = String.fromCharCode(h);
    f && (a.push(n.slice(r, u), encodeURIComponent(f)), r = u + c + 1, f = ""), c && (u += c, c = 0);
  }
  return a.join("") + n.slice(r);
}
function Nt(n, a, u, r) {
  const c = r ? r - 1 : 1 / 0;
  let h = 0;
  return f;
  function f(m) {
    return St(m) ? (n.enter(u), d(m)) : a(m);
  }
  function d(m) {
    return St(m) && h++ < c ? (n.consume(m), d) : (n.exit(u), a(m));
  }
}
function Pm(n, a, u, r, c, h) {
  let f = 0;
  return d;
  function d(y) {
    return St(y) ? (n.enter(r), m(y)) : p(y);
  }
  function m(y) {
    return St(y) && f < h ? (n.consume(y), f++, m) : (n.exit(r), p(y));
  }
  function p(y) {
    return f >= c ? a(y) : u(y);
  }
}
const bb = {
  tokenize: vb
};
function vb(n) {
  const a = n.attempt(this.parser.constructs.contentInitial, r, c);
  let u;
  return a;
  function r(d) {
    if (d === null) {
      n.consume(d);
      return;
    }
    return n.enter("lineEnding"), n.consume(d), n.exit("lineEnding"), Nt(n, a, "linePrefix");
  }
  function c(d) {
    return n.enter("paragraph"), h(d);
  }
  function h(d) {
    const m = n.enter("chunkText", {
      contentType: "text",
      previous: u
    });
    return u && (u.next = m), u = m, f(d);
  }
  function f(d) {
    if (d === null) {
      n.exit("chunkText"), n.exit("paragraph"), n.consume(d);
      return;
    }
    return ft(d) ? (n.consume(d), n.exit("chunkText"), h) : (n.consume(d), f);
  }
}
let lr = class {
  /**
   * Create a new edit map.
   *
   * @returns
   *   New instance.
   */
  constructor() {
    this.index = /* @__PURE__ */ new Map(), this.map = [];
  }
  /**
   * Create an edit: a remove and/or add at a certain place.
   *
   * @param {number} index
   *   Index at which to apply the edit.
   * @param {number} remove
   *   Count of items to remove at the index.
   * @param {Array<Event>} add
   *   Items to add at the index.
   * @returns {undefined}
   *   Nothing.
   */
  add(a, u, r) {
    lm(this, a, u, r, !1);
  }
  /**
   * Create an edit: but insert `add` before existing additions, instead of
   * after them.
   *
   * @param {number} index
   *   Index at which to apply the edit.
   * @param {number} remove
   *   Count of items to remove at the index.
   * @param {Array<Event>} add
   *   Items to add at the index.
   * @returns {undefined}
   *   Nothing.
   */
  addBefore(a, u, r) {
    lm(this, a, u, r, !0);
  }
  /**
   * Done, change the events.
   *
   * @param {Array<Event>} events
   *   List of events to apply the edits to.
   * @returns {undefined}
   *   Nothing.
   */
  consume(a) {
    if (this.map.sort(function(h, f) {
      return h[0] - f[0];
    }), this.map.length === 0)
      return;
    let u = this.map.length;
    const r = [];
    for (; u > 0; )
      u -= 1, r.push(a.slice(this.map[u][0] + this.map[u][1]), this.map[u][2]), a.length = this.map[u][0];
    r.push(a.slice()), a.length = 0;
    let c = r.pop();
    for (; c; ) {
      for (const h of c)
        a.push(h);
      c = r.pop();
    }
    this.map.length = 0, this.index.clear();
  }
};
function lm(n, a, u, r, c) {
  if (u === 0 && r.length === 0)
    return;
  const h = n.index.get(a);
  if (h) {
    h[1] += u, c ? (r.push(...h[2]), h[2] = r) : h[2].push(...r);
    return;
  }
  const f = [a, u, r];
  n.map.push(f), n.index.set(a, f);
}
const Sb = {
  tokenize: Eb
}, im = {
  tokenize: xb
};
function Eb(n) {
  const a = this, u = [];
  let r = 0, c, h, f;
  return d;
  function d(U) {
    if (r < u.length) {
      const W = u[r];
      return a.containerState = W[1], n.attempt(W[0].continuation, m, p)(U);
    }
    return p(U);
  }
  function m(U) {
    if (r++, a.containerState._closeFlow) {
      a.containerState._closeFlow = void 0, c && X();
      const W = a.events.length;
      let it = W, H;
      for (; it--; )
        if (a.events[it][0] === "exit" && a.events[it][1].type === "chunkFlow") {
          H = a.events[it][1].end;
          break;
        }
      z(r);
      let J = W;
      for (; J < a.events.length; )
        a.events[J][1].end = {
          ...H
        }, J++;
      const ct = new lr();
      return ct.add(it + 1, 0, a.events.slice(W)), ct.add(W, J - W, []), ct.consume(a.events), p(U);
    }
    return d(U);
  }
  function p(U) {
    if (r === u.length) {
      if (!c)
        return E(U);
      if (c.currentConstruct && c.currentConstruct.concrete)
        return A(U);
      a.interrupt = !!(c.currentConstruct && !c._gfmTableDynamicInterruptHack);
    }
    return a.containerState = {}, n.check(im, y, b)(U);
  }
  function y(U) {
    return c && X(), z(r), E(U);
  }
  function b(U) {
    return a.parser.lazy[a.now().line] = r !== u.length, f = a.now().offset, A(U);
  }
  function E(U) {
    return a.containerState = {}, n.attempt(im, v, A)(U);
  }
  function v(U) {
    return r++, u.push([a.currentConstruct, a.containerState]), E(U);
  }
  function A(U) {
    if (U === null) {
      c && X(), z(0), n.consume(U);
      return;
    }
    return c = c || a.parser.flow(a.now()), n.enter("chunkFlow", {
      _tokenizer: c,
      contentType: "flow",
      previous: h
    }), w(U);
  }
  function w(U) {
    if (U === null) {
      q(n.exit("chunkFlow"), !0), z(0), n.consume(U);
      return;
    }
    return ft(U) ? (n.consume(U), q(n.exit("chunkFlow")), r = 0, a.interrupt = void 0, d) : (n.consume(U), w);
  }
  function q(U, W) {
    const it = a.sliceStream(U);
    if (W && it.push(null), U.previous = h, h && (h.next = U), h = U, c.defineSkip(U.start), c.write(it), a.parser.lazy[U.start.line]) {
      let H = c.events.length;
      for (; H--; )
        if (
          // The token starts before the line ending…
          c.events[H][1].start.offset < f && // …and either is not ended yet…
          (!c.events[H][1].end || // …or ends after it.
          c.events[H][1].end.offset > f)
        )
          return;
      const J = a.events.length;
      let ct = J, Ct, B;
      for (; ct--; )
        if (a.events[ct][0] === "exit" && a.events[ct][1].type === "chunkFlow") {
          if (Ct) {
            B = a.events[ct][1].end;
            break;
          }
          Ct = !0;
        }
      for (z(r), H = J; H < a.events.length; )
        a.events[H][1].end = {
          ...B
        }, H++;
      const F = new lr();
      F.add(ct + 1, 0, a.events.slice(J)), F.add(J, H - J, []), F.consume(a.events);
    }
  }
  function z(U) {
    let W = u.length;
    for (; W-- > U; ) {
      const it = u[W];
      a.containerState = it[1], it[0].exit.call(a, n);
    }
    u.length = U;
  }
  function X() {
    c.write([null]), h = void 0, c = void 0, a.containerState._closeFlow = void 0;
  }
}
function xb(n, a, u) {
  return Nt(n, n.attempt(this.parser.constructs.document, a, u), "linePrefix", this.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4);
}
function rl(n) {
  if (n === null || Yt(n) || Nl(n))
    return 1;
  if (Na(n))
    return 2;
}
function cr(n, a, u) {
  const r = [];
  let c = -1;
  for (; ++c < n.length; ) {
    const h = n[c].resolveAll;
    h && !r.includes(h) && (a = h(a, u), r.push(h));
  }
  return a;
}
const as = {
  name: "attention",
  resolveAll: Tb,
  tokenize: Ab
};
function Tb(n, a) {
  let u = -1, r;
  for (; ++u < n.length; )
    if (n[u][0] === "enter" && n[u][1].type === "attentionSequence" && n[u][1]._close) {
      let c = u;
      for (; c--; )
        if (n[c][0] === "exit" && n[c][1].type === "attentionSequence" && n[c][1]._open && // If the markers are the same:
        a.sliceSerialize(n[c][1]).charCodeAt(0) === a.sliceSerialize(n[u][1]).charCodeAt(0)) {
          if ((n[c][1]._close || n[u][1]._open) && (n[u][1].end.offset - n[u][1].start.offset) % 3 && !((n[c][1].end.offset - n[c][1].start.offset + n[u][1].end.offset - n[u][1].start.offset) % 3))
            continue;
          const h = n[c][1].end.offset - n[c][1].start.offset > 1 && n[u][1].end.offset - n[u][1].start.offset > 1 ? 2 : 1, f = {
            ...n[c][1].end
          }, d = {
            ...n[u][1].start
          };
          am(f, -h), am(d, h);
          const m = {
            type: h > 1 ? "strongSequence" : "emphasisSequence",
            start: f,
            end: {
              ...n[c][1].end
            }
          }, p = {
            type: h > 1 ? "strongSequence" : "emphasisSequence",
            start: {
              ...n[u][1].start
            },
            end: d
          }, y = {
            type: h > 1 ? "strongText" : "emphasisText",
            start: {
              ...n[c][1].end
            },
            end: {
              ...n[u][1].start
            }
          }, b = {
            type: h > 1 ? "strong" : "emphasis",
            start: {
              ...m.start
            },
            end: {
              ...p.end
            }
          };
          n[c][1].end = {
            ...m.start
          }, n[u][1].start = {
            ...p.end
          }, r = [], n[c][1].end.offset - n[c][1].start.offset && (r = We(r, [["enter", n[c][1], a], ["exit", n[c][1], a]])), r = We(r, [["enter", b, a], ["enter", m, a], ["exit", m, a], ["enter", y, a]]), r = We(r, cr(a.parser.constructs.insideSpan.null, n.slice(c + 1, u), a)), r = We(r, [["exit", y, a], ["enter", p, a], ["exit", p, a], ["exit", b, a]]);
          let E = 0;
          n[u][1].end.offset - n[u][1].start.offset && (E = 2, r = We(r, [["enter", n[u][1], a], ["exit", n[u][1], a]])), ln(n, c - 1, u - c + 3, r), u = c + r.length - E - 2;
          break;
        }
    }
  for (u = -1; ++u < n.length; )
    n[u][1].type === "attentionSequence" && (n[u][1].type = "data");
  return n;
}
function Ab(n, a) {
  const u = this.parser.constructs.attentionMarkers.null, r = this.previous, c = rl(r);
  let h;
  return f;
  function f(m) {
    return h = m, n.enter("attentionSequence"), d(m);
  }
  function d(m) {
    if (m === h)
      return n.consume(m), d;
    const p = n.exit("attentionSequence"), y = rl(m), b = !y || y === 2 && c || u.includes(m) && m !== 42 && m !== 95, E = !c || c === 2 && y || u.includes(r) && r !== 42 && r !== 95;
    return p._open = !!(h === 42 ? b : b && (c || !E)), p._close = !!(h === 42 ? E : E && (y || !b)), a(m);
  }
}
function am(n, a) {
  n.column += a, n.offset += a, n._bufferIndex += a;
}
const Cb = {
  name: "autolink",
  tokenize: _b
};
function _b(n, a, u) {
  let r = 0;
  return c;
  function c(v) {
    return n.enter("autolink"), n.enter("autolinkMarker"), n.consume(v), n.exit("autolinkMarker"), n.enter("autolinkProtocol"), h;
  }
  function h(v) {
    return ge(v) ? (n.consume(v), f) : v === 64 ? u(v) : p(v);
  }
  function f(v) {
    return v === 43 || v === 45 || v === 46 || ye(v) ? (r = 1, d(v)) : p(v);
  }
  function d(v) {
    return v === 58 ? (n.consume(v), r = 0, m) : (v === 43 || v === 45 || v === 46 || ye(v)) && r++ < 32 ? (n.consume(v), d) : (r = 0, p(v));
  }
  function m(v) {
    return v === 62 ? (n.exit("autolinkProtocol"), n.enter("autolinkMarker"), n.consume(v), n.exit("autolinkMarker"), n.exit("autolink"), a) : v === null || v === 32 || v === 60 || nr(v) ? u(v) : (n.consume(v), m);
  }
  function p(v) {
    return v === 64 ? (n.consume(v), y) : gb(v) ? (n.consume(v), p) : u(v);
  }
  function y(v) {
    return ye(v) ? b(v) : u(v);
  }
  function b(v) {
    return v === 46 ? (n.consume(v), r = 0, y) : v === 62 ? (n.exit("autolinkProtocol").type = "autolinkEmail", n.enter("autolinkMarker"), n.consume(v), n.exit("autolinkMarker"), n.exit("autolink"), a) : E(v);
  }
  function E(v) {
    if ((v === 45 || ye(v)) && r++ < 63) {
      const A = v === 45 ? E : b;
      return n.consume(v), A;
    }
    return u(v);
  }
}
const Ra = {
  partial: !0,
  tokenize: kb
};
function kb(n, a, u) {
  return r;
  function r(h) {
    return St(h) ? Nt(n, c, "linePrefix")(h) : c(h);
  }
  function c(h) {
    return h === null || ft(h) ? a(h) : u(h);
  }
}
const tg = {
  continuation: {
    tokenize: wb
  },
  exit: Db,
  name: "blockQuote",
  tokenize: zb
};
function zb(n, a, u) {
  const r = this;
  return c;
  function c(f) {
    if (f === 62) {
      const d = r.containerState;
      return d.open || (n.enter("blockQuote", {
        _container: !0
      }), d.open = !0), n.enter("blockQuotePrefix"), n.enter("blockQuoteMarker"), n.consume(f), n.exit("blockQuoteMarker"), h;
    }
    return u(f);
  }
  function h(f) {
    return St(f) ? (n.enter("blockQuotePrefixWhitespace"), n.consume(f), n.exit("blockQuotePrefixWhitespace"), n.exit("blockQuotePrefix"), a) : (n.exit("blockQuotePrefix"), a(f));
  }
}
function wb(n, a, u) {
  const r = this;
  return c;
  function c(f) {
    return St(f) ? Nt(n, h, "linePrefix", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(f) : h(f);
  }
  function h(f) {
    return n.attempt(tg, a, u)(f);
  }
}
function Db(n) {
  n.exit("blockQuote");
}
const eg = {
  name: "characterEscape",
  tokenize: Ob
};
function Ob(n, a, u) {
  return r;
  function r(h) {
    return n.enter("characterEscape"), n.enter("escapeMarker"), n.consume(h), n.exit("escapeMarker"), c;
  }
  function c(h) {
    return Wm(h) ? (n.enter("characterEscapeValue"), n.consume(h), n.exit("characterEscapeValue"), n.exit("characterEscape"), a) : u(h);
  }
}
const ng = {
  name: "characterReference",
  tokenize: Nb
};
function Nb(n, a, u) {
  const r = this;
  let c = 0, h, f;
  return d;
  function d(b) {
    return n.enter("characterReference"), n.enter("characterReferenceMarker"), n.consume(b), n.exit("characterReferenceMarker"), m;
  }
  function m(b) {
    return b === 35 ? (n.enter("characterReferenceMarkerNumeric"), n.consume(b), n.exit("characterReferenceMarkerNumeric"), p) : (n.enter("characterReferenceValue"), h = 31, f = ye, y(b));
  }
  function p(b) {
    return b === 88 || b === 120 ? (n.enter("characterReferenceMarkerHexadecimal"), n.consume(b), n.exit("characterReferenceMarkerHexadecimal"), n.enter("characterReferenceValue"), h = 6, f = yb, y) : (n.enter("characterReferenceValue"), h = 7, f = is, y(b));
  }
  function y(b) {
    if (b === 59 && c) {
      const E = n.exit("characterReferenceValue");
      return f === ye && !As(r.sliceSerialize(E)) ? u(b) : (n.enter("characterReferenceMarker"), n.consume(b), n.exit("characterReferenceMarker"), n.exit("characterReference"), a);
    }
    return f(b) && c++ < h ? (n.consume(b), y) : u(b);
  }
}
const us = {
  partial: !0,
  tokenize: Rb
};
function Rb(n, a, u) {
  const r = this;
  return c;
  function c(f) {
    return f === null ? u(f) : (n.enter("lineEnding"), n.consume(f), n.exit("lineEnding"), h);
  }
  function h(f) {
    return r.parser.lazy[r.now().line] ? u(f) : a(f);
  }
}
const um = {
  concrete: !0,
  name: "codeFenced",
  tokenize: Mb
};
function Mb(n, a, u) {
  const r = this, c = {
    partial: !0,
    tokenize: it
  };
  let h = 0, f = 0, d;
  return m;
  function m(H) {
    return p(H);
  }
  function p(H) {
    const J = r.events[r.events.length - 1];
    return h = J && J[1].type === "linePrefix" ? J[2].sliceSerialize(J[1], !0).length : 0, d = H, n.enter("codeFenced"), n.enter("codeFencedFence"), n.enter("codeFencedFenceSequence"), y(H);
  }
  function y(H) {
    return H === d ? (f++, n.consume(H), y) : f < 3 ? u(H) : (n.exit("codeFencedFenceSequence"), St(H) ? Nt(n, b, "whitespace")(H) : b(H));
  }
  function b(H) {
    return H === null || ft(H) ? (n.exit("codeFencedFence"), r.interrupt ? a(H) : n.check(us, w, W)(H)) : (n.enter("codeFencedFenceInfo"), n.enter("chunkString", {
      contentType: "string"
    }), E(H));
  }
  function E(H) {
    return H === null || ft(H) ? (n.exit("chunkString"), n.exit("codeFencedFenceInfo"), b(H)) : St(H) ? (n.exit("chunkString"), n.exit("codeFencedFenceInfo"), Nt(n, v, "whitespace")(H)) : H === 96 && H === d ? u(H) : (n.consume(H), E);
  }
  function v(H) {
    return H === null || ft(H) ? b(H) : (n.enter("codeFencedFenceMeta"), n.enter("chunkString", {
      contentType: "string"
    }), A(H));
  }
  function A(H) {
    return H === null || ft(H) ? (n.exit("chunkString"), n.exit("codeFencedFenceMeta"), b(H)) : H === 96 && H === d ? u(H) : (n.consume(H), A);
  }
  function w(H) {
    return n.attempt(c, W, q)(H);
  }
  function q(H) {
    return n.enter("lineEnding"), n.consume(H), n.exit("lineEnding"), z;
  }
  function z(H) {
    return h > 0 && St(H) ? Nt(n, X, "linePrefix", h + 1)(H) : X(H);
  }
  function X(H) {
    return H === null || ft(H) ? n.check(us, w, W)(H) : (n.enter("codeFlowValue"), U(H));
  }
  function U(H) {
    return H === null || ft(H) ? (n.exit("codeFlowValue"), X(H)) : (n.consume(H), U);
  }
  function W(H) {
    return n.exit("codeFenced"), a(H);
  }
  function it(H, J, ct) {
    let Ct = 0;
    return B;
    function B(tt) {
      return H.enter("lineEnding"), H.consume(tt), H.exit("lineEnding"), F;
    }
    function F(tt) {
      return H.enter("codeFencedFence"), St(tt) ? Nt(H, nt, "linePrefix", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(tt) : nt(tt);
    }
    function nt(tt) {
      return tt === d ? (H.enter("codeFencedFenceSequence"), Et(tt)) : ct(tt);
    }
    function Et(tt) {
      return tt === d ? (Ct++, H.consume(tt), Et) : Ct >= f ? (H.exit("codeFencedFenceSequence"), St(tt) ? Nt(H, P, "whitespace")(tt) : P(tt)) : ct(tt);
    }
    function P(tt) {
      return tt === null || ft(tt) ? (H.exit("codeFencedFence"), J(tt)) : ct(tt);
    }
  }
}
const qc = {
  name: "codeIndented",
  tokenize: Lb
}, Ub = {
  partial: !0,
  tokenize: Bb
};
function Lb(n, a, u) {
  return r;
  function r(d) {
    return n.enter("codeIndented"), Pm(n, c, u, "linePrefix", 4, 4)(d);
  }
  function c(d) {
    return d === null ? f(d) : ft(d) ? n.attempt(Ub, c, f)(d) : (n.enter("codeFlowValue"), h(d));
  }
  function h(d) {
    return d === null || ft(d) ? (n.exit("codeFlowValue"), c(d)) : (n.consume(d), h);
  }
  function f(d) {
    return n.exit("codeIndented"), a(d);
  }
}
function Bb(n, a, u) {
  const r = this;
  return c;
  function c(f) {
    return r.parser.lazy[r.now().line] ? u(f) : ft(f) ? (n.enter("lineEnding"), n.consume(f), n.exit("lineEnding"), c) : Pm(n, a, h, "linePrefix", 4, 4)(f);
  }
  function h(f) {
    return ft(f) ? c(f) : u(f);
  }
}
const Hb = {
  name: "codeText",
  previous: qb,
  resolve: jb,
  tokenize: Ib
};
function jb(n) {
  let a = n.length - 4, u = 3, r, c;
  if ((n[u][1].type === "lineEnding" || n[u][1].type === "space") && (n[a][1].type === "lineEnding" || n[a][1].type === "space")) {
    for (r = u; ++r < a; )
      if (n[r][1].type === "codeTextData") {
        n[u][1].type = "codeTextPadding", n[a][1].type = "codeTextPadding", u += 2, a -= 2;
        break;
      }
  }
  for (r = u - 1, a++; ++r <= a; )
    c === void 0 ? r !== a && n[r][1].type !== "lineEnding" && (c = r) : (r === a || n[r][1].type === "lineEnding") && (n[c][1].type = "codeTextData", r !== c + 2 && (n[c][1].end = n[r - 1][1].end, n.splice(c + 2, r - c - 2), a -= r - c - 2, r = c + 2), c = void 0);
  return n;
}
function qb(n) {
  return n !== 96 || this.events[this.events.length - 1][1].type === "characterEscape";
}
function Ib(n, a, u) {
  let r = 0, c, h;
  return f;
  function f(b) {
    return n.enter("codeText"), n.enter("codeTextSequence"), d(b);
  }
  function d(b) {
    return b === 96 ? (n.consume(b), r++, d) : (n.exit("codeTextSequence"), m(b));
  }
  function m(b) {
    return b === null ? u(b) : b === 32 ? (n.enter("space"), n.consume(b), n.exit("space"), m) : b === 96 ? (h = n.enter("codeTextSequence"), c = 0, y(b)) : ft(b) ? (n.enter("lineEnding"), n.consume(b), n.exit("lineEnding"), m) : (n.enter("codeTextData"), p(b));
  }
  function p(b) {
    return b === null || b === 32 || b === 96 || ft(b) ? (n.exit("codeTextData"), m(b)) : (n.consume(b), p);
  }
  function y(b) {
    return b === 96 ? (n.consume(b), c++, y) : c === r ? (n.exit("codeTextSequence"), n.exit("codeText"), a(b)) : (h.type = "codeTextData", p(b));
  }
}
class Vb {
  /**
   * @param {ReadonlyArray<T> | null | undefined} [initial]
   *   Initial items (optional).
   * @returns
   *   Splice buffer.
   */
  constructor(a) {
    this.left = a ? [...a] : [], this.right = [];
  }
  /**
   * Array access;
   * does not move the cursor.
   *
   * @param {number} index
   *   Index.
   * @return {T}
   *   Item.
   */
  get(a) {
    if (a < 0 || a >= this.left.length + this.right.length)
      throw new RangeError("Cannot access index `" + a + "` in a splice buffer of size `" + (this.left.length + this.right.length) + "`");
    return a < this.left.length ? this.left[a] : this.right[this.right.length - a + this.left.length - 1];
  }
  /**
   * The length of the splice buffer, one greater than the largest index in the
   * array.
   */
  get length() {
    return this.left.length + this.right.length;
  }
  /**
   * Remove and return `list[0]`;
   * moves the cursor to `0`.
   *
   * @returns {T | undefined}
   *   Item, optional.
   */
  shift() {
    return this.setCursor(0), this.right.pop();
  }
  /**
   * Slice the buffer to get an array;
   * does not move the cursor.
   *
   * @param {number} start
   *   Start.
   * @param {number | null | undefined} [end]
   *   End (optional).
   * @returns {Array<T>}
   *   Array of items.
   */
  slice(a, u) {
    const r = u ?? Number.POSITIVE_INFINITY;
    return r < this.left.length ? this.left.slice(a, r) : a > this.left.length ? this.right.slice(this.right.length - r + this.left.length, this.right.length - a + this.left.length).reverse() : this.left.slice(a).concat(this.right.slice(this.right.length - r + this.left.length).reverse());
  }
  /**
   * Mimics the behavior of Array.prototype.splice() except for the change of
   * interface necessary to avoid segfaults when patching in very large arrays.
   *
   * This operation moves cursor is moved to `start` and results in the cursor
   * placed after any inserted items.
   *
   * @param {number} start
   *   Start;
   *   zero-based index at which to start changing the array;
   *   negative numbers count backwards from the end of the array and values
   *   that are out-of bounds are clamped to the appropriate end of the array.
   * @param {number | null | undefined} [deleteCount=0]
   *   Delete count (default: `0`);
   *   maximum number of elements to delete, starting from start.
   * @param {Array<T> | null | undefined} [items=[]]
   *   Items to include in place of the deleted items (default: `[]`).
   * @return {Array<T>}
   *   Any removed items.
   */
  splice(a, u, r) {
    const c = u || 0;
    this.setCursor(Math.trunc(a));
    const h = this.right.splice(this.right.length - c, Number.POSITIVE_INFINITY);
    return r && xa(this.left, r), h.reverse();
  }
  /**
   * Remove and return the highest-numbered item in the array, so
   * `list[list.length - 1]`;
   * Moves the cursor to `length`.
   *
   * @returns {T | undefined}
   *   Item, optional.
   */
  pop() {
    return this.setCursor(Number.POSITIVE_INFINITY), this.left.pop();
  }
  /**
   * Inserts a single item to the high-numbered side of the array;
   * moves the cursor to `length`.
   *
   * @param {T} item
   *   Item.
   * @returns {undefined}
   *   Nothing.
   */
  push(a) {
    this.setCursor(Number.POSITIVE_INFINITY), this.left.push(a);
  }
  /**
   * Inserts many items to the high-numbered side of the array.
   * Moves the cursor to `length`.
   *
   * @param {Array<T>} items
   *   Items.
   * @returns {undefined}
   *   Nothing.
   */
  pushMany(a) {
    this.setCursor(Number.POSITIVE_INFINITY), xa(this.left, a);
  }
  /**
   * Inserts a single item to the low-numbered side of the array;
   * Moves the cursor to `0`.
   *
   * @param {T} item
   *   Item.
   * @returns {undefined}
   *   Nothing.
   */
  unshift(a) {
    this.setCursor(0), this.right.push(a);
  }
  /**
   * Inserts many items to the low-numbered side of the array;
   * moves the cursor to `0`.
   *
   * @param {Array<T>} items
   *   Items.
   * @returns {undefined}
   *   Nothing.
   */
  unshiftMany(a) {
    this.setCursor(0), xa(this.right, a.reverse());
  }
  /**
   * Move the cursor to a specific position in the array. Requires
   * time proportional to the distance moved.
   *
   * If `n < 0`, the cursor will end up at the beginning.
   * If `n > length`, the cursor will end up at the end.
   *
   * @param {number} n
   *   Position.
   * @return {undefined}
   *   Nothing.
   */
  setCursor(a) {
    if (!(a === this.left.length || a > this.left.length && this.right.length === 0 || a < 0 && this.left.length === 0))
      if (a < this.left.length) {
        const u = this.left.splice(a, Number.POSITIVE_INFINITY);
        xa(this.right, u.reverse());
      } else {
        const u = this.right.splice(this.left.length + this.right.length - a, Number.POSITIVE_INFINITY);
        xa(this.left, u.reverse());
      }
  }
}
function xa(n, a) {
  let u = 0;
  if (a.length < 1e4)
    n.push(...a);
  else
    for (; u < a.length; )
      n.push(...a.slice(u, u + 1e4)), u += 1e4;
}
function lg(n) {
  const a = {};
  let u = -1, r, c, h, f, d, m, p;
  const y = new Vb(n);
  for (; ++u < y.length; ) {
    for (; u in a; )
      u = a[u];
    if (r = y.get(u), u && r[1].type === "chunkFlow" && y.get(u - 1)[1].type === "listItemPrefix" && (m = r[1]._tokenizer.events, h = 0, h < m.length && m[h][1].type === "lineEndingBlank" && (h += 2), h < m.length && m[h][1].type === "content"))
      for (; ++h < m.length && m[h][1].type !== "content"; )
        m[h][1].type === "chunkText" && (m[h][1]._isInFirstContentOfListItem = !0, h++);
    if (r[0] === "enter")
      r[1].contentType && (Object.assign(a, Yb(y, u)), u = a[u], p = !0);
    else if (r[1]._container) {
      for (h = u, c = void 0; h--; )
        if (f = y.get(h), f[1].type === "lineEnding" || f[1].type === "lineEndingBlank")
          f[0] === "enter" && (c && (y.get(c)[1].type = "lineEndingBlank"), f[1].type = "lineEnding", c = h);
        else if (!(f[1].type === "linePrefix" || f[1].type === "listItemIndent")) break;
      c && (r[1].end = {
        ...y.get(c)[1].start
      }, d = y.slice(c, u), d.unshift(r), y.splice(c, u - c + 1, d));
    }
  }
  return ln(n, 0, Number.POSITIVE_INFINITY, y.slice(0)), !p;
}
function Yb(n, a) {
  const u = n.get(a)[1], r = n.get(a)[2];
  let c = a - 1;
  const h = [];
  let f = u._tokenizer;
  f || (f = r.parser[u.contentType](u.start), u._contentTypeTextTrailing && (f._contentTypeTextTrailing = !0));
  const d = f.events, m = [], p = {};
  let y, b, E = -1, v = u, A = 0, w = 0;
  const q = [w];
  for (; v; ) {
    for (; n.get(++c)[1] !== v; )
      ;
    h.push(c), v._tokenizer || (y = r.sliceStream(v), v.next || y.push(null), b && f.defineSkip(v.start), v._isInFirstContentOfListItem && (f._gfmTasklistFirstContentOfListItem = !0), f.write(y), v._isInFirstContentOfListItem && (f._gfmTasklistFirstContentOfListItem = void 0)), b = v, v = v.next;
  }
  for (v = u; ++E < d.length; )
    // Find a void token that includes a break.
    d[E][0] === "exit" && d[E - 1][0] === "enter" && d[E][1].type === d[E - 1][1].type && d[E][1].start.line !== d[E][1].end.line && (w = E + 1, q.push(w), v._tokenizer = void 0, v.previous = void 0, v = v.next);
  for (f.events = [], v ? (v._tokenizer = void 0, v.previous = void 0) : q.pop(), E = q.length; E--; ) {
    const z = d.slice(q[E], q[E + 1]), X = h.pop();
    m.push([X, X + z.length - 1]), n.splice(X, 2, z);
  }
  for (m.reverse(), E = -1; ++E < m.length; )
    p[A + m[E][0]] = A + m[E][1], A += m[E][1] - m[E][0] - 1;
  return p;
}
const Gb = {
  resolve: Xb,
  tokenize: Zb
}, Qb = {
  partial: !0,
  tokenize: Kb
};
function Xb(n) {
  return lg(n), n;
}
function Zb(n, a) {
  let u;
  return r;
  function r(d) {
    return n.enter("content"), u = n.enter("chunkContent", {
      contentType: "content"
    }), c(d);
  }
  function c(d) {
    return d === null ? h(d) : ft(d) ? n.check(Qb, f, h)(d) : (n.consume(d), c);
  }
  function h(d) {
    return n.exit("chunkContent"), n.exit("content"), a(d);
  }
  function f(d) {
    return n.consume(d), n.exit("chunkContent"), u.next = n.enter("chunkContent", {
      contentType: "content",
      previous: u
    }), u = u.next, c;
  }
}
function Kb(n, a, u) {
  const r = this;
  return c;
  function c(f) {
    return n.exit("chunkContent"), n.enter("lineEnding"), n.consume(f), n.exit("lineEnding"), Nt(n, h, "linePrefix");
  }
  function h(f) {
    if (f === null || ft(f))
      return u(f);
    const d = r.events[r.events.length - 1];
    return !r.parser.constructs.disable.null.includes("codeIndented") && d && d[1].type === "linePrefix" && d[2].sliceSerialize(d[1], !0).length >= 4 ? a(f) : n.interrupt(r.parser.constructs.flow, u, a)(f);
  }
}
function ig(n, a, u, r, c, h, f, d, m) {
  const p = m || Number.POSITIVE_INFINITY;
  let y = 0;
  return b;
  function b(z) {
    return z === 60 ? (n.enter(r), n.enter(c), n.enter(h), n.consume(z), n.exit(h), E) : z === null || z === 32 || z === 41 || nr(z) ? u(z) : (n.enter(r), n.enter(f), n.enter(d), n.enter("chunkString", {
      contentType: "string"
    }), w(z));
  }
  function E(z) {
    return z === 62 ? (n.enter(h), n.consume(z), n.exit(h), n.exit(c), n.exit(r), a) : (n.enter(d), n.enter("chunkString", {
      contentType: "string"
    }), v(z));
  }
  function v(z) {
    return z === 62 ? (n.exit("chunkString"), n.exit(d), E(z)) : z === null || z === 60 || ft(z) ? u(z) : (n.consume(z), z === 92 ? A : v);
  }
  function A(z) {
    return z === 60 || z === 62 || z === 92 ? (n.consume(z), v) : v(z);
  }
  function w(z) {
    return !y && (z === null || z === 41 || Yt(z)) ? (n.exit("chunkString"), n.exit(d), n.exit(f), n.exit(r), a(z)) : y < p && z === 40 ? (n.consume(z), y++, w) : z === 41 ? (n.consume(z), y--, w) : z === null || z === 32 || z === 40 || nr(z) ? u(z) : (n.consume(z), z === 92 ? q : w);
  }
  function q(z) {
    return z === 40 || z === 41 || z === 92 ? (n.consume(z), w) : w(z);
  }
}
function ag(n, a, u, r, c, h) {
  const f = this;
  let d = 0, m;
  return p;
  function p(v) {
    return n.enter(r), n.enter(c), n.consume(v), n.exit(c), n.enter(h), y;
  }
  function y(v) {
    return d > 999 || v === null || v === 91 || v === 93 && !m || // To do: remove in the future once we’ve switched from
    // `micromark-extension-footnote` to `micromark-extension-gfm-footnote`,
    // which doesn’t need this.
    // Hidden footnotes hook.
    /* c8 ignore next 3 */
    v === 94 && !d && "_hiddenFootnoteSupport" in f.parser.constructs ? u(v) : v === 93 ? (n.exit(h), n.enter(c), n.consume(v), n.exit(c), n.exit(r), a) : ft(v) ? (n.enter("lineEnding"), n.consume(v), n.exit("lineEnding"), y) : (n.enter("chunkString", {
      contentType: "string"
    }), b(v));
  }
  function b(v) {
    return v === null || v === 91 || v === 93 || ft(v) || d++ > 999 ? (n.exit("chunkString"), y(v)) : (n.consume(v), m || (m = !St(v)), v === 92 ? E : b);
  }
  function E(v) {
    return v === 91 || v === 92 || v === 93 ? (n.consume(v), d++, b) : b(v);
  }
}
function ug(n, a, u, r, c, h) {
  let f;
  return d;
  function d(E) {
    return E === 34 || E === 39 || E === 40 ? (n.enter(r), n.enter(c), n.consume(E), n.exit(c), f = E === 40 ? 41 : E, m) : u(E);
  }
  function m(E) {
    return E === f ? (n.enter(c), n.consume(E), n.exit(c), n.exit(r), a) : (n.enter(h), p(E));
  }
  function p(E) {
    return E === f ? (n.exit(h), m(f)) : E === null ? u(E) : ft(E) ? (n.enter("lineEnding"), n.consume(E), n.exit("lineEnding"), Nt(n, p, "linePrefix")) : (n.enter("chunkString", {
      contentType: "string"
    }), y(E));
  }
  function y(E) {
    return E === f || E === null || ft(E) ? (n.exit("chunkString"), p(E)) : (n.consume(E), E === 92 ? b : y);
  }
  function b(E) {
    return E === f || E === 92 ? (n.consume(E), y) : y(E);
  }
}
function ka(n, a) {
  let u;
  return r;
  function r(c) {
    return ft(c) ? (n.enter("lineEnding"), n.consume(c), n.exit("lineEnding"), u = !0, r) : St(c) ? Nt(n, r, u ? "linePrefix" : "lineSuffix")(c) : a(c);
  }
}
const Jb = {
  name: "definition",
  tokenize: $b
}, Fb = {
  partial: !0,
  tokenize: Wb
};
function $b(n, a, u) {
  const r = this;
  let c;
  return h;
  function h(v) {
    return n.enter("definition"), f(v);
  }
  function f(v) {
    return ag.call(
      r,
      n,
      d,
      // Note: we don’t need to reset the way `markdown-rs` does.
      u,
      "definitionLabel",
      "definitionLabelMarker",
      "definitionLabelString"
    )(v);
  }
  function d(v) {
    return c = an(r.sliceSerialize(r.events[r.events.length - 1][1]).slice(1, -1)), v === 58 ? (n.enter("definitionMarker"), n.consume(v), n.exit("definitionMarker"), m) : u(v);
  }
  function m(v) {
    return Yt(v) ? ka(n, p)(v) : p(v);
  }
  function p(v) {
    return ig(
      n,
      y,
      // Note: we don’t need to reset the way `markdown-rs` does.
      u,
      "definitionDestination",
      "definitionDestinationLiteral",
      "definitionDestinationLiteralMarker",
      "definitionDestinationRaw",
      "definitionDestinationString"
    )(v);
  }
  function y(v) {
    return n.attempt(Fb, b, b)(v);
  }
  function b(v) {
    return St(v) ? Nt(n, E, "whitespace")(v) : E(v);
  }
  function E(v) {
    return v === null || ft(v) ? (n.exit("definition"), r.parser.defined.push(c), a(v)) : u(v);
  }
}
function Wb(n, a, u) {
  return r;
  function r(d) {
    return Yt(d) ? ka(n, c)(d) : u(d);
  }
  function c(d) {
    return ug(n, h, u, "definitionTitle", "definitionTitleMarker", "definitionTitleString")(d);
  }
  function h(d) {
    return St(d) ? Nt(n, f, "whitespace")(d) : f(d);
  }
  function f(d) {
    return d === null || ft(d) ? a(d) : u(d);
  }
}
const Pb = {
  name: "hardBreakEscape",
  tokenize: tv
};
function tv(n, a, u) {
  return r;
  function r(h) {
    return n.enter("hardBreakEscape"), n.consume(h), c;
  }
  function c(h) {
    return ft(h) ? (n.exit("hardBreakEscape"), a(h)) : u(h);
  }
}
const ev = {
  name: "headingAtx",
  resolve: nv,
  tokenize: lv
};
function nv(n, a) {
  let u = n.length - 2, r = 3;
  if (n[r][1].type === "whitespace" && (r += 2), u - 2 > r && n[u][1].type === "whitespace" && (u -= 2), n[u][1].type === "atxHeadingSequence" && (r === u - 1 || u - 4 > r && n[u - 2][1].type === "whitespace") && (u -= r + 1 === u ? 2 : 4), u > r) {
    const c = {
      type: "atxHeadingText",
      start: n[r][1].start,
      end: n[u][1].end
    }, h = {
      type: "chunkText",
      start: n[r][1].start,
      end: n[u][1].end,
      contentType: "text"
    };
    ln(n, r, u - r + 1, [["enter", c, a], ["enter", h, a], ["exit", h, a], ["exit", c, a]]);
  }
  return n;
}
function lv(n, a, u) {
  let r = 0;
  return c;
  function c(y) {
    return n.enter("atxHeading"), h(y);
  }
  function h(y) {
    return n.enter("atxHeadingSequence"), f(y);
  }
  function f(y) {
    return y === 35 && r++ < 6 ? (n.consume(y), f) : y === null || Yt(y) ? (n.exit("atxHeadingSequence"), d(y)) : u(y);
  }
  function d(y) {
    return y === 35 ? (n.enter("atxHeadingSequence"), m(y)) : y === null || ft(y) ? (n.exit("atxHeading"), a(y)) : St(y) ? Nt(n, d, "whitespace")(y) : (n.enter("atxHeadingText"), p(y));
  }
  function m(y) {
    return y === 35 ? (n.consume(y), m) : (n.exit("atxHeadingSequence"), d(y));
  }
  function p(y) {
    return y === null || y === 35 || Yt(y) ? (n.exit("atxHeadingText"), d(y)) : (n.consume(y), p);
  }
}
const rg = [
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul"
], rs = ["pre", "script", "style", "textarea"], iv = {
  concrete: !0,
  name: "htmlFlow",
  resolveTo: uv,
  tokenize: rv
}, av = {
  partial: !0,
  tokenize: ov
};
function uv(n) {
  let a = n.length;
  for (; a-- && !(n[a][0] === "enter" && n[a][1].type === "htmlFlow"); )
    ;
  return a > 1 && n[a - 2][1].type === "linePrefix" && (n[a][1].start = n[a - 2][1].start, n[a + 1][1].start = n[a - 2][1].start, n.splice(a - 2, 2)), n;
}
function rv(n, a, u) {
  const r = this;
  let c, h, f, d, m;
  return p;
  function p(x) {
    return y(x);
  }
  function y(x) {
    return n.enter("htmlFlow"), n.enter("htmlFlowData"), n.consume(x), b;
  }
  function b(x) {
    return x === 33 ? (n.consume(x), E) : x === 47 ? (n.consume(x), h = !0, w) : x === 63 ? (n.consume(x), c = 3, r.interrupt ? a : T) : ge(x) ? (n.consume(x), f = String.fromCharCode(x), q) : u(x);
  }
  function E(x) {
    return x === 45 ? (n.consume(x), c = 2, v) : x === 91 ? (n.consume(x), c = 5, d = 0, A) : ge(x) ? (n.consume(x), c = 4, r.interrupt ? a : T) : u(x);
  }
  function v(x) {
    return x === 45 ? (n.consume(x), r.interrupt ? a : T) : u(x);
  }
  function A(x) {
    const $ = "CDATA[";
    return x === $.charCodeAt(d++) ? (n.consume(x), d === $.length ? r.interrupt ? a : nt : A) : u(x);
  }
  function w(x) {
    return ge(x) ? (n.consume(x), f = String.fromCharCode(x), q) : u(x);
  }
  function q(x) {
    if (x === null || x === 47 || x === 62 || Yt(x)) {
      const $ = x === 47, ot = f.toLowerCase();
      return !$ && !h && rs.includes(ot) ? (c = 1, r.interrupt ? a(x) : nt(x)) : rg.includes(f.toLowerCase()) ? (c = 6, $ ? (n.consume(x), z) : r.interrupt ? a(x) : nt(x)) : (c = 7, r.interrupt && !r.parser.lazy[r.now().line] ? u(x) : h ? X(x) : U(x));
    }
    return x === 45 || ye(x) ? (n.consume(x), f += String.fromCharCode(x), q) : u(x);
  }
  function z(x) {
    return x === 62 ? (n.consume(x), r.interrupt ? a : nt) : u(x);
  }
  function X(x) {
    return St(x) ? (n.consume(x), X) : B(x);
  }
  function U(x) {
    return x === 47 ? (n.consume(x), B) : x === 58 || x === 95 || ge(x) ? (n.consume(x), W) : St(x) ? (n.consume(x), U) : B(x);
  }
  function W(x) {
    return x === 45 || x === 46 || x === 58 || x === 95 || ye(x) ? (n.consume(x), W) : it(x);
  }
  function it(x) {
    return x === 61 ? (n.consume(x), H) : St(x) ? (n.consume(x), it) : U(x);
  }
  function H(x) {
    return x === null || x === 60 || x === 61 || x === 62 || x === 96 ? u(x) : x === 34 || x === 39 ? (n.consume(x), m = x, J) : St(x) ? (n.consume(x), H) : ct(x);
  }
  function J(x) {
    return x === m ? (n.consume(x), m = null, Ct) : x === null || ft(x) ? u(x) : (n.consume(x), J);
  }
  function ct(x) {
    return x === null || x === 34 || x === 39 || x === 47 || x === 60 || x === 61 || x === 62 || x === 96 || Yt(x) ? it(x) : (n.consume(x), ct);
  }
  function Ct(x) {
    return x === 47 || x === 62 || St(x) ? U(x) : u(x);
  }
  function B(x) {
    return x === 62 ? (n.consume(x), F) : u(x);
  }
  function F(x) {
    return x === null || ft(x) ? nt(x) : St(x) ? (n.consume(x), F) : u(x);
  }
  function nt(x) {
    return x === 45 && c === 2 ? (n.consume(x), O) : x === 60 && c === 1 ? (n.consume(x), I) : x === 62 && c === 4 ? (n.consume(x), _) : x === 63 && c === 3 ? (n.consume(x), T) : x === 93 && c === 5 ? (n.consume(x), ht) : ft(x) && (c === 6 || c === 7) ? (n.exit("htmlFlowData"), n.check(av, Y, Et)(x)) : x === null || ft(x) ? (n.exit("htmlFlowData"), Et(x)) : (n.consume(x), nt);
  }
  function Et(x) {
    return n.check(us, P, Y)(x);
  }
  function P(x) {
    return n.enter("lineEnding"), n.consume(x), n.exit("lineEnding"), tt;
  }
  function tt(x) {
    return x === null || ft(x) ? Et(x) : (n.enter("htmlFlowData"), nt(x));
  }
  function O(x) {
    return x === 45 ? (n.consume(x), T) : nt(x);
  }
  function I(x) {
    return x === 47 ? (n.consume(x), f = "", et) : nt(x);
  }
  function et(x) {
    if (x === 62) {
      const $ = f.toLowerCase();
      return rs.includes($) ? (n.consume(x), _) : nt(x);
    }
    return ge(x) && f.length < 8 ? (n.consume(x), f += String.fromCharCode(x), et) : nt(x);
  }
  function ht(x) {
    return x === 93 ? (n.consume(x), T) : nt(x);
  }
  function T(x) {
    return x === 62 ? (n.consume(x), _) : x === 45 && c === 2 ? (n.consume(x), T) : nt(x);
  }
  function _(x) {
    return x === null || ft(x) ? (n.exit("htmlFlowData"), Y(x)) : (n.consume(x), _);
  }
  function Y(x) {
    return n.exit("htmlFlow"), a(x);
  }
}
function ov(n, a, u) {
  return r;
  function r(c) {
    return n.enter("lineEnding"), n.consume(c), n.exit("lineEnding"), n.attempt(Ra, a, u);
  }
}
const cv = {
  name: "htmlText",
  tokenize: sv
};
function sv(n, a, u) {
  const r = this;
  let c, h, f;
  return d;
  function d(T) {
    return n.enter("htmlText"), n.enter("htmlTextData"), n.consume(T), m;
  }
  function m(T) {
    return T === 33 ? (n.consume(T), p) : T === 47 ? (n.consume(T), it) : T === 63 ? (n.consume(T), U) : ge(T) ? (n.consume(T), ct) : u(T);
  }
  function p(T) {
    return T === 45 ? (n.consume(T), y) : T === 91 ? (n.consume(T), h = 0, A) : ge(T) ? (n.consume(T), X) : u(T);
  }
  function y(T) {
    return T === 45 ? (n.consume(T), v) : u(T);
  }
  function b(T) {
    return T === null ? u(T) : T === 45 ? (n.consume(T), E) : ft(T) ? (f = b, I(T)) : (n.consume(T), b);
  }
  function E(T) {
    return T === 45 ? (n.consume(T), v) : b(T);
  }
  function v(T) {
    return T === 62 ? O(T) : T === 45 ? E(T) : b(T);
  }
  function A(T) {
    const _ = "CDATA[";
    return T === _.charCodeAt(h++) ? (n.consume(T), h === _.length ? w : A) : u(T);
  }
  function w(T) {
    return T === null ? u(T) : T === 93 ? (n.consume(T), q) : ft(T) ? (f = w, I(T)) : (n.consume(T), w);
  }
  function q(T) {
    return T === 93 ? (n.consume(T), z) : w(T);
  }
  function z(T) {
    return T === 62 ? O(T) : T === 93 ? (n.consume(T), z) : w(T);
  }
  function X(T) {
    return T === null || T === 62 ? O(T) : ft(T) ? (f = X, I(T)) : (n.consume(T), X);
  }
  function U(T) {
    return T === null ? u(T) : T === 63 ? (n.consume(T), W) : ft(T) ? (f = U, I(T)) : (n.consume(T), U);
  }
  function W(T) {
    return T === 62 ? O(T) : U(T);
  }
  function it(T) {
    return ge(T) ? (n.consume(T), H) : u(T);
  }
  function H(T) {
    return T === 45 || ye(T) ? (n.consume(T), H) : J(T);
  }
  function J(T) {
    return ft(T) ? (f = J, I(T)) : St(T) ? (n.consume(T), J) : O(T);
  }
  function ct(T) {
    return T === 45 || ye(T) ? (n.consume(T), ct) : T === 47 || T === 62 || Yt(T) ? Ct(T) : u(T);
  }
  function Ct(T) {
    return T === 47 ? (n.consume(T), O) : T === 58 || T === 95 || ge(T) ? (n.consume(T), B) : ft(T) ? (f = Ct, I(T)) : St(T) ? (n.consume(T), Ct) : O(T);
  }
  function B(T) {
    return T === 45 || T === 46 || T === 58 || T === 95 || ye(T) ? (n.consume(T), B) : F(T);
  }
  function F(T) {
    return T === 61 ? (n.consume(T), nt) : ft(T) ? (f = F, I(T)) : St(T) ? (n.consume(T), F) : Ct(T);
  }
  function nt(T) {
    return T === null || T === 60 || T === 61 || T === 62 || T === 96 ? u(T) : T === 34 || T === 39 ? (n.consume(T), c = T, Et) : ft(T) ? (f = nt, I(T)) : St(T) ? (n.consume(T), nt) : (n.consume(T), P);
  }
  function Et(T) {
    return T === c ? (n.consume(T), c = void 0, tt) : T === null ? u(T) : ft(T) ? (f = Et, I(T)) : (n.consume(T), Et);
  }
  function P(T) {
    return T === null || T === 34 || T === 39 || T === 60 || T === 61 || T === 96 ? u(T) : T === 47 || T === 62 || Yt(T) ? Ct(T) : (n.consume(T), P);
  }
  function tt(T) {
    return T === 47 || T === 62 || Yt(T) ? Ct(T) : u(T);
  }
  function O(T) {
    return T === 62 ? (n.consume(T), n.exit("htmlTextData"), n.exit("htmlText"), a) : u(T);
  }
  function I(T) {
    return n.exit("htmlTextData"), n.enter("lineEnding"), n.consume(T), n.exit("lineEnding"), et;
  }
  function et(T) {
    return St(T) ? Nt(n, ht, "linePrefix", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(T) : ht(T);
  }
  function ht(T) {
    return n.enter("htmlTextData"), f(T);
  }
}
const Cs = {
  name: "labelEnd",
  resolveAll: pv,
  resolveTo: mv,
  tokenize: gv
}, fv = {
  tokenize: yv
}, hv = {
  tokenize: bv
}, dv = {
  tokenize: vv
};
function pv(n) {
  let a = -1;
  const u = [];
  for (; ++a < n.length; ) {
    const r = n[a][1];
    if (u.push(n[a]), r.type === "labelImage" || r.type === "labelLink" || r.type === "labelEnd") {
      const c = r.type === "labelImage" ? 4 : 2;
      r.type = "data", a += c;
    }
  }
  return n.length !== u.length && ln(n, 0, n.length, u), n;
}
function mv(n, a) {
  let u = n.length, r = 0, c, h, f;
  for (; u--; ) {
    const y = n[u][1];
    if (c) {
      if (y.type === "link" || y.type === "labelLink" && y._inactive)
        break;
      n[u][0] === "enter" && y.type === "labelLink" && (y._inactive = !0);
    } else if (h) {
      if (n[u][0] === "enter" && (y.type === "labelImage" || y.type === "labelLink") && !y._balanced && (c = u, y.type !== "labelLink")) {
        r = 2;
        break;
      }
    } else y.type === "labelEnd" && (h = u);
  }
  const d = {
    type: n[c][1].type === "labelLink" ? "link" : "image",
    start: {
      ...n[c][1].start
    },
    end: {
      ...n[n.length - 1][1].end
    }
  }, m = {
    type: "label",
    start: {
      ...n[c][1].start
    },
    end: {
      ...n[h][1].end
    }
  }, p = {
    type: "labelText",
    start: {
      ...n[c + r + 2][1].end
    },
    end: {
      ...n[h - 2][1].start
    }
  };
  return f = [["enter", d, a], ["enter", m, a]], f = We(f, n.slice(c + 1, c + r + 3)), f = We(f, [["enter", p, a]]), f = We(f, cr(a.parser.constructs.insideSpan.null, n.slice(c + r + 4, h - 3), a)), f = We(f, [["exit", p, a], n[h - 2], n[h - 1], ["exit", m, a]]), f = We(f, n.slice(h + 1)), f = We(f, [["exit", d, a]]), ln(n, c, n.length, f), n;
}
function gv(n, a, u) {
  const r = this, c = r._labelStarts;
  let h, f;
  if (c) {
    for (; c.length > 0 && c[c.length - 1]._balanced; )
      c.pop();
    h = c[c.length - 1];
  }
  return d;
  function d(E) {
    return h ? h._inactive ? b(E) : (f = r.parser.defined.includes(an(r.sliceSerialize({
      start: h.end,
      end: r.now()
    }))), n.enter("labelEnd"), n.enter("labelMarker"), n.consume(E), n.exit("labelMarker"), n.exit("labelEnd"), m) : u(E);
  }
  function m(E) {
    return E === 40 ? n.attempt(fv, y, f ? y : b)(E) : E === 91 ? n.attempt(hv, y, f ? p : b)(E) : f ? y(E) : b(E);
  }
  function p(E) {
    return n.attempt(dv, y, b)(E);
  }
  function y(E) {
    return c.pop(), a(E);
  }
  function b(E) {
    return h._balanced = !0, u(E);
  }
}
function yv(n, a, u) {
  return r;
  function r(b) {
    return n.enter("resource"), n.enter("resourceMarker"), n.consume(b), n.exit("resourceMarker"), c;
  }
  function c(b) {
    return Yt(b) ? ka(n, h)(b) : h(b);
  }
  function h(b) {
    return b === 41 ? y(b) : ig(n, f, d, "resourceDestination", "resourceDestinationLiteral", "resourceDestinationLiteralMarker", "resourceDestinationRaw", "resourceDestinationString", 32)(b);
  }
  function f(b) {
    return Yt(b) ? ka(n, m)(b) : y(b);
  }
  function d(b) {
    return u(b);
  }
  function m(b) {
    return b === 34 || b === 39 || b === 40 ? ug(n, p, u, "resourceTitle", "resourceTitleMarker", "resourceTitleString")(b) : y(b);
  }
  function p(b) {
    return Yt(b) ? ka(n, y)(b) : y(b);
  }
  function y(b) {
    return b === 41 ? (n.enter("resourceMarker"), n.consume(b), n.exit("resourceMarker"), n.exit("resource"), a) : u(b);
  }
}
function bv(n, a, u) {
  const r = this;
  return c;
  function c(d) {
    return ag.call(r, n, h, f, "reference", "referenceMarker", "referenceString")(d);
  }
  function h(d) {
    return r.parser.defined.includes(an(r.sliceSerialize(r.events[r.events.length - 1][1]).slice(1, -1))) ? a(d) : u(d);
  }
  function f(d) {
    return u(d);
  }
}
function vv(n, a, u) {
  return r;
  function r(h) {
    return n.enter("reference"), n.enter("referenceMarker"), n.consume(h), n.exit("referenceMarker"), c;
  }
  function c(h) {
    return h === 93 ? (n.enter("referenceMarker"), n.consume(h), n.exit("referenceMarker"), n.exit("reference"), a) : u(h);
  }
}
const Sv = {
  name: "labelStartImage",
  resolveAll: Cs.resolveAll,
  tokenize: Ev
};
function Ev(n, a, u) {
  const r = this;
  let c;
  return h;
  function h(m) {
    return n.enter("labelImage"), n.enter("labelImageMarker"), n.consume(m), n.exit("labelImageMarker"), f;
  }
  function f(m) {
    return m === 91 ? (n.enter("labelMarker"), n.consume(m), n.exit("labelMarker"), c = n.exit("labelImage"), d) : u(m);
  }
  function d(m) {
    return m === 94 && "_hiddenFootnoteSupport" in r.parser.constructs ? u(m) : (r._labelStarts = r._labelStarts || [], r._labelStarts.push(c), a(m));
  }
}
const xv = {
  name: "labelStartLink",
  resolveAll: Cs.resolveAll,
  tokenize: Tv
};
function Tv(n, a, u) {
  const r = this;
  let c;
  return h;
  function h(d) {
    return n.enter("labelLink"), n.enter("labelMarker"), n.consume(d), n.exit("labelMarker"), c = n.exit("labelLink"), f;
  }
  function f(d) {
    return d === 94 && "_hiddenFootnoteSupport" in r.parser.constructs ? u(d) : (r._labelStarts = r._labelStarts || [], r._labelStarts.push(c), a(d));
  }
}
const Ic = {
  name: "lineEnding",
  tokenize: Av
};
function Av(n, a) {
  return u;
  function u(r) {
    return n.enter("lineEnding"), n.consume(r), n.exit("lineEnding"), Nt(n, a, "linePrefix");
  }
}
const er = {
  name: "thematicBreak",
  tokenize: Cv
};
function Cv(n, a, u) {
  let r = 0, c;
  return h;
  function h(p) {
    return n.enter("thematicBreak"), f(p);
  }
  function f(p) {
    return c = p, d(p);
  }
  function d(p) {
    return p === c ? (n.enter("thematicBreakSequence"), m(p)) : r >= 3 && (p === null || ft(p)) ? (n.exit("thematicBreak"), a(p)) : u(p);
  }
  function m(p) {
    return p === c ? (n.consume(p), r++, m) : (n.exit("thematicBreakSequence"), St(p) ? Nt(n, d, "whitespace")(p) : d(p));
  }
}
const Ne = {
  continuation: {
    tokenize: wv
  },
  exit: Ov,
  name: "list",
  tokenize: zv
}, _v = {
  partial: !0,
  tokenize: Nv
}, kv = {
  partial: !0,
  tokenize: Dv
};
function zv(n, a, u) {
  const r = this, c = r.events[r.events.length - 1];
  let h = c && c[1].type === "linePrefix" ? c[2].sliceSerialize(c[1], !0).length : 0, f = 0;
  return d;
  function d(v) {
    const A = r.containerState.type || (v === 42 || v === 43 || v === 45 ? "listUnordered" : "listOrdered");
    if (A === "listUnordered" ? !r.containerState.marker || v === r.containerState.marker : is(v)) {
      if (r.containerState.type || (r.containerState.type = A, n.enter(A, {
        _container: !0
      })), A === "listUnordered")
        return n.enter("listItemPrefix"), v === 42 || v === 45 ? n.check(er, u, p)(v) : p(v);
      if (!r.interrupt || v === 49)
        return n.enter("listItemPrefix"), n.enter("listItemValue"), m(v);
    }
    return u(v);
  }
  function m(v) {
    return is(v) && ++f < 10 ? (n.consume(v), m) : (!r.interrupt || f < 2) && (r.containerState.marker ? v === r.containerState.marker : v === 41 || v === 46) ? (n.exit("listItemValue"), p(v)) : u(v);
  }
  function p(v) {
    return n.enter("listItemMarker"), n.consume(v), n.exit("listItemMarker"), r.containerState.marker = r.containerState.marker || v, n.check(
      Ra,
      // Can’t be empty when interrupting.
      r.interrupt ? u : y,
      n.attempt(_v, E, b)
    );
  }
  function y(v) {
    return r.containerState.initialBlankLine = !0, h++, E(v);
  }
  function b(v) {
    return St(v) ? (n.enter("listItemPrefixWhitespace"), n.consume(v), n.exit("listItemPrefixWhitespace"), E) : u(v);
  }
  function E(v) {
    return r.containerState.size = h + r.sliceSerialize(n.exit("listItemPrefix"), !0).length, a(v);
  }
}
function wv(n, a, u) {
  const r = this;
  return r.containerState._closeFlow = void 0, n.check(Ra, c, h);
  function c(d) {
    return r.containerState.furtherBlankLines = r.containerState.furtherBlankLines || r.containerState.initialBlankLine, Nt(n, a, "listItemIndent", r.containerState.size + 1)(d);
  }
  function h(d) {
    return r.containerState.furtherBlankLines || !St(d) ? (r.containerState.furtherBlankLines = void 0, r.containerState.initialBlankLine = void 0, f(d)) : (r.containerState.furtherBlankLines = void 0, r.containerState.initialBlankLine = void 0, n.attempt(kv, a, f)(d));
  }
  function f(d) {
    return r.containerState._closeFlow = !0, r.interrupt = void 0, Nt(n, n.attempt(Ne, a, u), "linePrefix", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(d);
  }
}
function Dv(n, a, u) {
  const r = this;
  return Nt(n, c, "listItemIndent", r.containerState.size + 1);
  function c(h) {
    const f = r.events[r.events.length - 1];
    return f && f[1].type === "listItemIndent" && f[2].sliceSerialize(f[1], !0).length === r.containerState.size ? a(h) : u(h);
  }
}
function Ov(n) {
  n.exit(this.containerState.type);
}
function Nv(n, a, u) {
  const r = this;
  return Nt(n, c, "listItemPrefixWhitespace", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 5);
  function c(h) {
    const f = r.events[r.events.length - 1];
    return !St(h) && f && f[1].type === "listItemPrefixWhitespace" ? a(h) : u(h);
  }
}
const rm = {
  name: "setextUnderline",
  resolveTo: Rv,
  tokenize: Mv
};
function Rv(n, a) {
  const u = new lr();
  let r = n.length, c, h, f;
  for (; r--; )
    if (n[r][0] === "enter") {
      if (n[r][1].type === "content") {
        c = r;
        break;
      }
      n[r][1].type === "paragraph" && (h = r);
    } else
      n[r][1].type === "content" && u.add(r, 1, []), !f && n[r][1].type === "definition" && (f = r);
  const d = {
    type: "setextHeading",
    start: {
      ...n[c][1].start
    },
    end: {
      ...n[n.length - 1][1].end
    }
  };
  return n[h][1].type = "setextHeadingText", f ? (u.add(h, 0, [["enter", d, a]]), u.add(f + 1, 0, [["exit", n[c][1], a]]), n[c][1].end = {
    ...n[f][1].end
  }) : n[c][1] = d, u.add(n.length, 0, [["exit", d, a]]), u.consume(n), n;
}
function Mv(n, a, u) {
  const r = this;
  let c;
  return h;
  function h(p) {
    let y = r.events.length, b;
    for (; y--; )
      if (r.events[y][1].type !== "lineEnding" && r.events[y][1].type !== "linePrefix" && r.events[y][1].type !== "content") {
        b = r.events[y][1].type === "paragraph";
        break;
      }
    return !r.parser.lazy[r.now().line] && (r.interrupt || b) ? (n.enter("setextHeadingLine"), c = p, f(p)) : u(p);
  }
  function f(p) {
    return n.enter("setextHeadingLineSequence"), d(p);
  }
  function d(p) {
    return p === c ? (n.consume(p), d) : (n.exit("setextHeadingLineSequence"), St(p) ? Nt(n, m, "lineSuffix")(p) : m(p));
  }
  function m(p) {
    return p === null || ft(p) ? (n.exit("setextHeadingLine"), a(p)) : u(p);
  }
}
const Uv = {
  tokenize: Lv
};
function Lv(n) {
  const a = this, u = n.attempt(
    // Try to parse a blank line.
    Ra,
    r,
    // Try to parse initial flow (essentially, only code).
    n.attempt(this.parser.constructs.flowInitial, c, Nt(n, n.attempt(this.parser.constructs.flow, c, n.attempt(Gb, c)), "linePrefix"))
  );
  return u;
  function r(h) {
    if (h === null) {
      n.consume(h);
      return;
    }
    return n.enter("lineEndingBlank"), n.consume(h), n.exit("lineEndingBlank"), a.currentConstruct = void 0, u;
  }
  function c(h) {
    if (h === null) {
      n.consume(h);
      return;
    }
    return n.enter("lineEnding"), n.consume(h), n.exit("lineEnding"), a.currentConstruct = void 0, u;
  }
}
const Bv = {
  resolveAll: cg()
}, Hv = og("string"), jv = og("text");
function og(n) {
  return {
    resolveAll: cg(n === "text" ? qv : void 0),
    tokenize: a
  };
  function a(u) {
    const r = this, c = this.parser.constructs[n], h = u.attempt(c, f, d);
    return f;
    function f(y) {
      return p(y) ? h(y) : d(y);
    }
    function d(y) {
      if (y === null) {
        u.consume(y);
        return;
      }
      return u.enter("data"), u.consume(y), m;
    }
    function m(y) {
      return p(y) ? (u.exit("data"), h(y)) : (u.consume(y), m);
    }
    function p(y) {
      if (y === null)
        return !0;
      const b = c[y];
      let E = -1;
      if (b)
        for (; ++E < b.length; ) {
          const v = b[E];
          if (!v.previous || v.previous.call(r, r.previous))
            return !0;
        }
      return !1;
    }
  }
}
function cg(n) {
  return a;
  function a(u, r) {
    let c = -1, h;
    for (; ++c <= u.length; )
      h === void 0 ? u[c] && u[c][1].type === "data" && (h = c, c++) : (!u[c] || u[c][1].type !== "data") && (c !== h + 2 && (u[h][1].end = u[c - 1][1].end, u.splice(h + 2, c - h - 2), c = h + 2), h = void 0);
    return n ? n(u, r) : u;
  }
}
function qv(n, a) {
  const u = new lr();
  let r = 0;
  for (; ++r <= n.length; )
    if ((r === n.length || n[r][1].type === "lineEnding") && n[r - 1][1].type === "data") {
      const c = n[r - 1][1], h = a.sliceStream(c);
      let f = h.length, d = -1, m = 0, p;
      for (; f--; ) {
        const y = h[f];
        if (typeof y == "string") {
          for (d = y.length; y.charCodeAt(d - 1) === 32; )
            m++, d--;
          if (d)
            break;
          d = -1;
        } else if (y === -2)
          p = !0, m++;
        else if (y !== -1) {
          f++;
          break;
        }
      }
      if (a._contentTypeTextTrailing && r === n.length && (m = 0), m) {
        const y = {
          type: r === n.length || p || m < 2 ? "lineSuffix" : "hardBreakTrailing",
          start: {
            _bufferIndex: f ? d : c.start._bufferIndex + d,
            _index: c.start._index + f,
            line: c.end.line,
            column: c.end.column - m,
            offset: c.end.offset - m
          },
          end: {
            ...c.end
          }
        };
        c.end = {
          ...y.start
        }, c.start.offset === c.end.offset ? Object.assign(c, y) : u.add(r, 0, [["enter", y, a], ["exit", y, a]]);
      }
      r++;
    }
  return u.consume(n), n;
}
const Iv = {
  42: Ne,
  43: Ne,
  45: Ne,
  48: Ne,
  49: Ne,
  50: Ne,
  51: Ne,
  52: Ne,
  53: Ne,
  54: Ne,
  55: Ne,
  56: Ne,
  57: Ne,
  62: tg
}, Vv = {
  91: Jb
}, Yv = {
  [-2]: qc,
  [-1]: qc,
  32: qc
}, Gv = {
  35: ev,
  42: er,
  45: [rm, er],
  60: iv,
  61: rm,
  95: er,
  96: um,
  126: um
}, Qv = {
  38: ng,
  92: eg
}, Xv = {
  [-5]: Ic,
  [-4]: Ic,
  [-3]: Ic,
  33: Sv,
  38: ng,
  42: as,
  60: [Cb, cv],
  91: xv,
  92: [Pb, eg],
  93: Cs,
  95: as,
  96: Hb
}, Zv = {
  null: [as, Bv]
}, Kv = {
  null: [42, 95]
}, Jv = {
  null: []
}, Fv = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  attentionMarkers: Kv,
  contentInitial: Vv,
  disable: Jv,
  document: Iv,
  flow: Gv,
  flowInitial: Yv,
  insideSpan: Zv,
  string: Qv,
  text: Xv
}, Symbol.toStringTag, { value: "Module" }));
function $v(n, a, u) {
  let r = {
    _bufferIndex: -1,
    _index: 0,
    line: u && u.line || 1,
    column: u && u.column || 1,
    offset: u && u.offset || 0
  };
  const c = {}, h = [];
  let f = [], d = [];
  const m = {
    attempt: J(it),
    check: J(H),
    consume: X,
    enter: U,
    exit: W,
    interrupt: J(H, {
      interrupt: !0
    })
  }, p = {
    code: null,
    containerState: {},
    defineSkip: w,
    events: [],
    now: A,
    parser: n,
    previous: null,
    sliceSerialize: E,
    sliceStream: v,
    write: b
  };
  let y = a.tokenize.call(p, m);
  return a.resolveAll && h.push(a), p;
  function b(F) {
    return f = We(f, F), q(), f[f.length - 1] !== null ? [] : (ct(a, 0), p.events = cr(h, p.events, p), p.events);
  }
  function E(F, nt) {
    return Pv(v(F), nt);
  }
  function v(F) {
    return Wv(f, F);
  }
  function A() {
    const {
      _bufferIndex: F,
      _index: nt,
      line: Et,
      column: P,
      offset: tt
    } = r;
    return {
      _bufferIndex: F,
      _index: nt,
      line: Et,
      column: P,
      offset: tt
    };
  }
  function w(F) {
    c[F.line] = F.column, B();
  }
  function q() {
    for (; r._index < f.length; ) {
      const F = f[r._index];
      if (typeof F == "string") {
        const nt = r._index;
        for (r._bufferIndex < 0 && (r._bufferIndex = 0); r._index === nt && r._bufferIndex < F.length; )
          z(F.charCodeAt(r._bufferIndex));
      } else
        z(F);
    }
  }
  function z(F) {
    y = y(F);
  }
  function X(F) {
    ft(F) ? (r.line++, r.column = 1, r.offset += F === -3 ? 2 : 1, B()) : F !== -1 && (r.column++, r.offset++), r._bufferIndex < 0 ? r._index++ : (r._bufferIndex++, r._bufferIndex === // Points w/ non-negative `_bufferIndex` reference
    // strings.
    /** @type {string} */
    f[r._index].length && (r._bufferIndex = -1, r._index++)), p.previous = F;
  }
  function U(F, nt) {
    const Et = nt || {};
    return Et.type = F, Et.start = A(), p.events.push(["enter", Et, p]), d.push(Et), Et;
  }
  function W(F) {
    const nt = d.pop();
    return nt.end = A(), p.events.push(["exit", nt, p]), nt;
  }
  function it(F, nt) {
    ct(F, nt.from);
  }
  function H(F, nt) {
    nt.restore();
  }
  function J(F, nt) {
    return Et;
    function Et(P, tt, O) {
      let I, et, ht, T;
      return Array.isArray(P) ? (
        /* c8 ignore next 1 */
        Y(P)
      ) : "tokenize" in P ? (
        // Looks like a construct.
        Y([
          /** @type {Construct} */
          P
        ])
      ) : _(P);
      function _(ut) {
        return xt;
        function xt(wt) {
          const bt = wt !== null && ut[wt], be = wt !== null && ut.null, un = [
            // To do: add more extension tests.
            /* c8 ignore next 2 */
            ...Array.isArray(bt) ? bt : bt ? [bt] : [],
            ...Array.isArray(be) ? be : be ? [be] : []
          ];
          return Y(un)(wt);
        }
      }
      function Y(ut) {
        return I = ut, et = 0, ut.length === 0 ? O : x(ut[et]);
      }
      function x(ut) {
        return xt;
        function xt(wt) {
          return T = Ct(), ht = ut, ut.partial || (p.currentConstruct = ut), ut.name && p.parser.constructs.disable.null.includes(ut.name) ? ot() : ut.tokenize.call(
            // If we do have fields, create an object w/ `context` as its
            // prototype.
            // This allows a “live binding”, which is needed for `interrupt`.
            nt ? Object.assign(Object.create(p), nt) : p,
            m,
            $,
            ot
          )(wt);
        }
      }
      function $(ut) {
        return F(ht, T), tt;
      }
      function ot(ut) {
        return T.restore(), ++et < I.length ? x(I[et]) : O;
      }
    }
  }
  function ct(F, nt) {
    F.resolveAll && !h.includes(F) && h.push(F), F.resolve && ln(p.events, nt, p.events.length - nt, F.resolve(p.events.slice(nt), p)), F.resolveTo && (p.events = F.resolveTo(p.events, p));
  }
  function Ct() {
    const F = A(), nt = p.previous, Et = p.currentConstruct, P = p.events.length, tt = Array.from(d);
    return {
      from: P,
      restore: O
    };
    function O() {
      r = F, p.previous = nt, p.currentConstruct = Et, p.events.length = P, d = tt, B();
    }
  }
  function B() {
    r.line in c && r.column < 2 && (r.column = c[r.line], r.offset += c[r.line] - 1);
  }
}
function Wv(n, a) {
  const u = a.start._index, r = a.start._bufferIndex, c = a.end._index, h = a.end._bufferIndex;
  let f;
  if (u === c)
    f = [n[u].slice(r, h)];
  else {
    if (f = n.slice(u, c), r > -1) {
      const d = f[0];
      typeof d == "string" ? f[0] = d.slice(r) : f.shift();
    }
    h > 0 && f.push(n[c].slice(0, h));
  }
  return f;
}
function Pv(n, a) {
  let u = -1;
  const r = [];
  let c;
  for (; ++u < n.length; ) {
    const h = n[u];
    let f;
    if (typeof h == "string")
      f = h;
    else
      switch (h) {
        case -5: {
          f = "\r";
          break;
        }
        case -4: {
          f = `
`;
          break;
        }
        case -3: {
          f = `\r
`;
          break;
        }
        case -2: {
          f = a ? " " : "	";
          break;
        }
        case -1: {
          if (!a && c)
            continue;
          f = " ";
          break;
        }
        default:
          f = String.fromCharCode(h);
      }
    c = h === -2, r.push(f);
  }
  return r.join("");
}
function tS(n) {
  const r = {
    constructs: (
      /** @type {FullNormalizedExtension} */
      Fm([Fv, ...(n || {}).extensions || []])
    ),
    content: c(bb),
    defined: [],
    document: c(Sb),
    flow: c(Uv),
    lazy: {},
    string: c(Hv),
    text: c(jv)
  };
  return r;
  function c(h) {
    return f;
    function f(d) {
      return $v(r, h, d);
    }
  }
}
function eS(n) {
  for (; !lg(n); )
    ;
  return n;
}
const om = /[\0\t\n\r]/g;
function nS() {
  let n = 1, a = "", u = !0, r;
  return c;
  function c(h, f, d) {
    h = a + (typeof h == "string" ? h.toString() : new TextDecoder(f || void 0).decode(h));
    const m = [];
    let p = 0;
    for (a = "", u && (h.charCodeAt(0) === 65279 && p++, u = void 0); p < h.length; ) {
      om.lastIndex = p;
      const y = om.exec(h), b = y && y.index !== void 0 ? y.index : h.length, E = h.charCodeAt(b);
      if (!y) {
        a = h.slice(p);
        break;
      }
      if (E === 10 && p === b && r)
        m.push(-3), r = void 0;
      else
        switch (r && (m.push(-5), r = void 0), p < b && (m.push(h.slice(p, b)), n += b - p), E) {
          case 0: {
            m.push(65533), n++;
            break;
          }
          case 9: {
            const v = Math.ceil(n / 4) * 4;
            for (m.push(-2); n++ < v; )
              m.push(-1);
            break;
          }
          case 10: {
            m.push(-4), n = 1;
            break;
          }
          default:
            r = !0, n = 1;
        }
      p = b + 1;
    }
    return d && (r && m.push(-5), a && m.push(a), m.push(null)), m;
  }
}
const lS = /\\([!-/:-@[-`{-~])|&(#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi;
function iS(n) {
  return n.replace(lS, aS);
}
function aS(n, a, u) {
  if (a)
    return a;
  if (u.charCodeAt(0) === 35) {
    const c = u.charCodeAt(1), h = c === 120 || c === 88;
    return $m(u.slice(h ? 2 : 1), h ? 16 : 10);
  }
  return As(u) || n;
}
const sg = {}.hasOwnProperty;
function uS(n, a, u) {
  return a && typeof a == "object" && (u = a, a = void 0), rS(u)(eS(tS(u).document().write(nS()(n, a, !0))));
}
function rS(n) {
  const a = {
    afterExit: [],
    beforeEnter: [],
    transforms: [],
    canContainEols: ["emphasis", "fragment", "heading", "paragraph", "strong"],
    enter: {
      autolink: f(Ul),
      autolinkProtocol: B,
      autolinkEmail: B,
      atxHeading: f(Pt),
      blockQuote: f(un),
      characterEscape: B,
      characterReference: B,
      codeFenced: f(rn),
      codeFencedFenceInfo: d,
      codeFencedFenceMeta: d,
      codeIndented: f(rn, d),
      codeText: f(pn, d),
      codeTextData: B,
      data: B,
      codeFlowValue: B,
      definition: f(Wt),
      definitionDestinationString: d,
      definitionLabelString: d,
      definitionTitleString: d,
      emphasis: f(Un),
      hardBreakEscape: f(Ml),
      hardBreakTrailing: f(Ml),
      htmlFlow: f(Ci, d),
      htmlFlowData: B,
      htmlText: f(Ci, d),
      htmlTextData: B,
      image: f(_i),
      label: d,
      link: f(Ul),
      listItem: f(gr),
      listItemValue: v,
      listOrdered: f(Ll, E),
      listUnordered: f(Ll),
      paragraph: f(yr),
      reference: $,
      referenceString: d,
      resourceDestinationString: d,
      resourceTitleString: d,
      setextHeading: f(Pt),
      strong: f(Ee),
      thematicBreak: f(Ua)
    },
    exit: {
      atxHeading: p(),
      atxHeadingSequence: H,
      autolink: p(),
      autolinkEmail: be,
      autolinkProtocol: bt,
      blockQuote: p(),
      characterEscapeValue: F,
      characterReferenceMarkerHexadecimal: ut,
      characterReferenceMarkerNumeric: ut,
      characterReferenceValue: xt,
      characterReference: wt,
      codeFenced: p(z),
      codeFencedFence: q,
      codeFencedFenceInfo: A,
      codeFencedFenceMeta: w,
      codeFlowValue: F,
      codeIndented: p(X),
      codeText: p(O),
      codeTextData: F,
      data: F,
      definition: p(),
      definitionDestinationString: it,
      definitionLabelString: U,
      definitionTitleString: W,
      emphasis: p(),
      hardBreakEscape: p(Et),
      hardBreakTrailing: p(Et),
      htmlFlow: p(P),
      htmlFlowData: F,
      htmlText: p(tt),
      htmlTextData: F,
      image: p(et),
      label: T,
      labelText: ht,
      lineEnding: nt,
      link: p(I),
      listItem: p(),
      listOrdered: p(),
      listUnordered: p(),
      paragraph: p(),
      referenceString: ot,
      resourceDestinationString: _,
      resourceTitleString: Y,
      resource: x,
      setextHeading: p(Ct),
      setextHeadingLineSequence: ct,
      setextHeadingText: J,
      strong: p(),
      thematicBreak: p()
    }
  };
  fg(a, (n || {}).mdastExtensions || []);
  const u = {};
  return r;
  function r(j) {
    let K = {
      type: "root",
      children: [],
      position: void 0
    };
    const dt = {
      stack: [K],
      tokenStack: [],
      config: a,
      enter: m,
      exit: y,
      buffer: d,
      resume: b,
      data: u
    }, gt = [], ve = [];
    let qt = -1;
    for (; ++qt < j.length; )
      if (ve.push(j[qt]), j[qt][1].type === "listOrdered" || j[qt][1].type === "listUnordered")
        if (j[qt][0] === "enter")
          gt.push(ve.length - 1);
        else {
          const te = gt.pop();
          h(ve, te);
        }
    for (j = ve, qt = -1; ++qt < j.length; ) {
      const te = a[j[qt][0]];
      j[qt][0] === "enter" && a.beforeEnter.length > 0 && c(a.beforeEnter, {
        ...dt,
        sliceSerialize: j[qt][2].sliceSerialize
      }, j[qt][1]), sg.call(te, j[qt][1].type) && te[j[qt][1].type].call({
        ...dt,
        sliceSerialize: j[qt][2].sliceSerialize
      }, j[qt][1]), j[qt][0] === "exit" && a.afterExit.length > 0 && c(a.afterExit, {
        ...dt,
        sliceSerialize: j[qt][2].sliceSerialize
      }, j[qt][1]);
    }
    if (dt.tokenStack.length > 0) {
      const te = dt.tokenStack[dt.tokenStack.length - 1];
      (te[1] || cm).call(dt, void 0, te[0]);
    }
    for (K.position = {
      start: ul(j.length > 0 ? j[0][1].start : {
        line: 1,
        column: 1,
        offset: 0
      }),
      end: ul(j.length > 0 ? j[j.length - 2][1].end : {
        line: 1,
        column: 1,
        offset: 0
      })
    }, qt = -1; ++qt < a.transforms.length; )
      K = a.transforms[qt](K) || K;
    return K;
  }
  function c(j, K, dt) {
    let gt = -1;
    for (; ++gt < j.length; )
      j[gt].call(K, dt);
  }
  function h(j, K) {
    const dt = j.length - 1;
    let gt = K - 1, ve = -1, qt = !1, te, Xt, Te, ue;
    const cl = [];
    for (; ++gt <= dt; ) {
      const oe = j[gt];
      switch (oe[1].type) {
        case "listUnordered":
        case "listOrdered":
        case "blockQuote": {
          oe[0] === "enter" ? ve++ : ve--, ue = void 0;
          break;
        }
        case "lineEndingBlank": {
          oe[0] === "enter" && (te && !ue && !ve && !Te && (Te = gt), ue = void 0);
          break;
        }
        case "linePrefix":
        case "listItemValue":
        case "listItemMarker":
        case "listItemPrefix":
        case "listItemPrefixWhitespace":
          break;
        default:
          ue = void 0;
      }
      if (!ve && oe[0] === "enter" && oe[1].type === "listItemPrefix" || ve === -1 && oe[0] === "exit" && (oe[1].type === "listUnordered" || oe[1].type === "listOrdered")) {
        if (te) {
          let Pe = gt;
          for (Xt = void 0; Pe--; ) {
            const Ae = j[Pe];
            if (Ae[1].type === "lineEnding" || Ae[1].type === "lineEndingBlank") {
              if (Ae[0] === "exit") continue;
              Xt && (j[Xt][1].type = "lineEndingBlank", qt = !0), Ae[1].type = "lineEnding", Xt = Pe;
            } else if (!(Ae[1].type === "linePrefix" || Ae[1].type === "blockQuotePrefix" || Ae[1].type === "blockQuotePrefixWhitespace" || Ae[1].type === "blockQuoteMarker" || Ae[1].type === "listItemIndent")) break;
          }
          Te && (!Xt || Te < Xt) && (te._spread = !0), te.end = Object.assign({}, Xt ? j[Xt][1].start : oe[1].end), cl.push({
            at: Xt || gt,
            event: ["exit", te, oe[2]]
          });
        }
        if (oe[1].type === "listItemPrefix") {
          const Pe = {
            type: "listItem",
            _spread: !1,
            start: Object.assign({}, oe[1].start),
            // @ts-expect-error: we’ll add `end` in a second.
            end: void 0
          };
          te = Pe, cl.push({
            at: gt,
            event: ["enter", Pe, oe[2]]
          }), Te = void 0, ue = !0;
        }
      }
    }
    const La = j.splice(K);
    let ki = 0;
    for (gt = -1; ++gt < La.length; ) {
      for (; ki < cl.length && cl[ki].at === K + gt; )
        j.push(cl[ki++].event);
      j.push(La[gt]);
    }
    j[K][1]._spread = qt;
  }
  function f(j, K) {
    return dt;
    function dt(gt) {
      m.call(this, j(gt), gt), K && K.call(this, gt);
    }
  }
  function d() {
    this.stack.push({
      type: "fragment",
      children: []
    });
  }
  function m(j, K, dt) {
    this.stack[this.stack.length - 1].children.push(j), this.stack.push(j), this.tokenStack.push([K, dt || void 0]), j.position = {
      start: ul(K.start),
      // @ts-expect-error: `end` will be patched later.
      end: void 0
    };
  }
  function p(j) {
    return K;
    function K(dt) {
      j && j.call(this, dt), y.call(this, dt);
    }
  }
  function y(j, K) {
    const dt = this.stack.pop(), gt = this.tokenStack.pop();
    if (!gt)
      throw new Error("Cannot close `" + j.type + "` (" + _a({
        start: j.start,
        end: j.end
      }) + "): it’s not open");
    gt[0].type !== j.type && (K ? K.call(this, j, gt[0]) : (gt[1] || cm).call(this, j, gt[0])), dt.position.end = ul(j.end);
  }
  function b() {
    return or(this.stack.pop());
  }
  function E() {
    this.data.expectingFirstListItemValue = !0;
  }
  function v(j) {
    if (this.data.expectingFirstListItemValue) {
      const K = this.stack[this.stack.length - 2];
      K.start = Number.parseInt(this.sliceSerialize(j), 10), this.data.expectingFirstListItemValue = void 0;
    }
  }
  function A() {
    const j = this.resume(), K = this.stack[this.stack.length - 1];
    K.lang = j;
  }
  function w() {
    const j = this.resume(), K = this.stack[this.stack.length - 1];
    K.meta = j;
  }
  function q() {
    this.data.flowCodeInside || (this.buffer(), this.data.flowCodeInside = !0);
  }
  function z() {
    const j = this.resume(), K = this.stack[this.stack.length - 1];
    K.value = j.replace(/^(\r?\n|\r)|(\r?\n|\r)$/g, ""), this.data.flowCodeInside = void 0;
  }
  function X() {
    const j = this.resume(), K = this.stack[this.stack.length - 1];
    K.value = j.replace(/(\r?\n|\r)$/g, "");
  }
  function U(j) {
    const K = this.resume(), dt = this.stack[this.stack.length - 1];
    dt.label = K, dt.identifier = an(this.sliceSerialize(j)).toLowerCase();
  }
  function W() {
    const j = this.resume(), K = this.stack[this.stack.length - 1];
    K.title = j;
  }
  function it() {
    const j = this.resume(), K = this.stack[this.stack.length - 1];
    K.url = j;
  }
  function H(j) {
    const K = this.stack[this.stack.length - 1];
    if (!K.depth) {
      const dt = this.sliceSerialize(j).length;
      K.depth = dt;
    }
  }
  function J() {
    this.data.setextHeadingSlurpLineEnding = !0;
  }
  function ct(j) {
    const K = this.stack[this.stack.length - 1];
    K.depth = this.sliceSerialize(j).codePointAt(0) === 61 ? 1 : 2;
  }
  function Ct() {
    this.data.setextHeadingSlurpLineEnding = void 0;
  }
  function B(j) {
    const dt = this.stack[this.stack.length - 1].children;
    let gt = dt[dt.length - 1];
    (!gt || gt.type !== "text") && (gt = br(), gt.position = {
      start: ul(j.start),
      // @ts-expect-error: we’ll add `end` later.
      end: void 0
    }, dt.push(gt)), this.stack.push(gt);
  }
  function F(j) {
    const K = this.stack.pop();
    K.value += this.sliceSerialize(j), K.position.end = ul(j.end);
  }
  function nt(j) {
    const K = this.stack[this.stack.length - 1];
    if (this.data.atHardBreak) {
      const dt = K.children[K.children.length - 1];
      dt.position.end = ul(j.end), this.data.atHardBreak = void 0;
      return;
    }
    !this.data.setextHeadingSlurpLineEnding && a.canContainEols.includes(K.type) && (B.call(this, j), F.call(this, j));
  }
  function Et() {
    this.data.atHardBreak = !0;
  }
  function P() {
    const j = this.resume(), K = this.stack[this.stack.length - 1];
    K.value = j;
  }
  function tt() {
    const j = this.resume(), K = this.stack[this.stack.length - 1];
    K.value = j;
  }
  function O() {
    const j = this.resume(), K = this.stack[this.stack.length - 1];
    K.value = j;
  }
  function I() {
    const j = this.stack[this.stack.length - 1];
    if (this.data.inReference) {
      const K = this.data.referenceType || "shortcut";
      j.type += "Reference", j.referenceType = K, delete j.url, delete j.title;
    } else
      delete j.identifier, delete j.label;
    this.data.referenceType = void 0;
  }
  function et() {
    const j = this.stack[this.stack.length - 1];
    if (this.data.inReference) {
      const K = this.data.referenceType || "shortcut";
      j.type += "Reference", j.referenceType = K, delete j.url, delete j.title;
    } else
      delete j.identifier, delete j.label;
    this.data.referenceType = void 0;
  }
  function ht(j) {
    const K = this.sliceSerialize(j), dt = this.stack[this.stack.length - 2];
    dt.label = iS(K), dt.identifier = an(K).toLowerCase();
  }
  function T() {
    const j = this.stack[this.stack.length - 1], K = this.resume(), dt = this.stack[this.stack.length - 1];
    if (this.data.inReference = !0, dt.type === "link") {
      const gt = j.children;
      dt.children = gt;
    } else
      dt.alt = K;
  }
  function _() {
    const j = this.resume(), K = this.stack[this.stack.length - 1];
    K.url = j;
  }
  function Y() {
    const j = this.resume(), K = this.stack[this.stack.length - 1];
    K.title = j;
  }
  function x() {
    this.data.inReference = void 0;
  }
  function $() {
    this.data.referenceType = "collapsed";
  }
  function ot(j) {
    const K = this.resume(), dt = this.stack[this.stack.length - 1];
    dt.label = K, dt.identifier = an(this.sliceSerialize(j)).toLowerCase(), this.data.referenceType = "full";
  }
  function ut(j) {
    this.data.characterReferenceType = j.type;
  }
  function xt(j) {
    const K = this.sliceSerialize(j), dt = this.data.characterReferenceType;
    let gt;
    dt ? (gt = $m(K, dt === "characterReferenceMarkerNumeric" ? 10 : 16), this.data.characterReferenceType = void 0) : gt = As(K);
    const ve = this.stack[this.stack.length - 1];
    ve.value += gt;
  }
  function wt(j) {
    const K = this.stack.pop();
    K.position.end = ul(j.end);
  }
  function bt(j) {
    F.call(this, j);
    const K = this.stack[this.stack.length - 1];
    K.url = this.sliceSerialize(j);
  }
  function be(j) {
    F.call(this, j);
    const K = this.stack[this.stack.length - 1];
    K.url = "mailto:" + this.sliceSerialize(j);
  }
  function un() {
    return {
      type: "blockquote",
      children: [],
      position: void 0
    };
  }
  function rn() {
    return {
      type: "code",
      lang: null,
      meta: null,
      value: "",
      position: void 0
    };
  }
  function pn() {
    return {
      type: "inlineCode",
      value: "",
      position: void 0
    };
  }
  function Wt() {
    return {
      type: "definition",
      identifier: "",
      label: null,
      title: null,
      url: "",
      position: void 0
    };
  }
  function Un() {
    return {
      type: "emphasis",
      children: [],
      position: void 0
    };
  }
  function Pt() {
    return {
      type: "heading",
      // @ts-expect-error `depth` will be set later.
      depth: 0,
      children: [],
      position: void 0
    };
  }
  function Ml() {
    return {
      type: "break",
      position: void 0
    };
  }
  function Ci() {
    return {
      type: "html",
      value: "",
      position: void 0
    };
  }
  function _i() {
    return {
      type: "image",
      title: null,
      url: "",
      alt: null,
      position: void 0
    };
  }
  function Ul() {
    return {
      type: "link",
      title: null,
      url: "",
      children: [],
      position: void 0
    };
  }
  function Ll(j) {
    return {
      type: "list",
      ordered: j.type === "listOrdered",
      start: null,
      spread: j._spread,
      children: [],
      position: void 0
    };
  }
  function gr(j) {
    return {
      type: "listItem",
      spread: j._spread,
      checked: null,
      children: [],
      position: void 0
    };
  }
  function yr() {
    return {
      type: "paragraph",
      children: [],
      position: void 0
    };
  }
  function Ee() {
    return {
      type: "strong",
      children: [],
      position: void 0
    };
  }
  function br() {
    return {
      type: "text",
      value: "",
      position: void 0
    };
  }
  function Ua() {
    return {
      type: "thematicBreak",
      position: void 0
    };
  }
}
function ul(n) {
  return {
    line: n.line,
    column: n.column,
    offset: n.offset
  };
}
function fg(n, a) {
  let u = -1;
  for (; ++u < a.length; ) {
    const r = a[u];
    Array.isArray(r) ? fg(n, r) : oS(n, r);
  }
}
function oS(n, a) {
  let u;
  for (u in a)
    if (sg.call(a, u))
      switch (u) {
        case "canContainEols": {
          const r = a[u];
          r && n[u].push(...r);
          break;
        }
        case "transforms": {
          const r = a[u];
          r && n[u].push(...r);
          break;
        }
        case "afterExit":
        case "beforeEnter": {
          const r = a[u];
          r && n[u].push(r);
          break;
        }
        case "enter":
        case "exit": {
          const r = a[u];
          r && Object.assign(n[u], r);
          break;
        }
      }
}
function cm(n, a) {
  throw n ? new Error("Cannot close `" + n.type + "` (" + _a({
    start: n.start,
    end: n.end
  }) + "): a different token (`" + a.type + "`, " + _a({
    start: a.start,
    end: a.end
  }) + ") is open") : new Error("Cannot close document, a token (`" + a.type + "`, " + _a({
    start: a.start,
    end: a.end
  }) + ") is still open");
}
function cS(n) {
  const a = this;
  a.parser = u;
  function u(r) {
    return uS(r, {
      ...a.data("settings"),
      ...n,
      // Note: these options are not in the readme.
      // The goal is for them to be set by plugins on `data` instead of being
      // passed by users.
      extensions: a.data("micromarkExtensions") || [],
      mdastExtensions: a.data("fromMarkdownExtensions") || []
    });
  }
}
function sS(n, a) {
  const u = {
    type: "element",
    tagName: "blockquote",
    properties: {},
    children: n.wrap(n.all(a), !0)
  };
  return n.patch(a, u), n.applyData(a, u);
}
function fS(n, a) {
  const u = { type: "element", tagName: "br", properties: {}, children: [] };
  return n.patch(a, u), [n.applyData(a, u), { type: "text", value: `
` }];
}
function hS(n, a) {
  const u = a.value ? a.value + `
` : "", r = {}, c = a.lang ? a.lang.split(/\s+/) : [];
  c.length > 0 && (r.className = ["language-" + c[0]]);
  let h = {
    type: "element",
    tagName: "code",
    properties: r,
    children: [{ type: "text", value: u }]
  };
  return a.meta && (h.data = { meta: a.meta }), n.patch(a, h), h = n.applyData(a, h), h = { type: "element", tagName: "pre", properties: {}, children: [h] }, n.patch(a, h), h;
}
function dS(n, a) {
  const u = {
    type: "element",
    tagName: "del",
    properties: {},
    children: n.all(a)
  };
  return n.patch(a, u), n.applyData(a, u);
}
function pS(n, a) {
  const u = {
    type: "element",
    tagName: "em",
    properties: {},
    children: n.all(a)
  };
  return n.patch(a, u), n.applyData(a, u);
}
function mS(n, a) {
  const u = typeof n.options.clobberPrefix == "string" ? n.options.clobberPrefix : "user-content-", r = String(a.identifier).toUpperCase(), c = Ai(r.toLowerCase()), h = n.footnoteOrder.indexOf(r);
  let f, d = n.footnoteCounts.get(r);
  d === void 0 ? (d = 0, n.footnoteOrder.push(r), f = n.footnoteOrder.length) : f = h + 1, d += 1, n.footnoteCounts.set(r, d);
  const m = {
    type: "element",
    tagName: "a",
    properties: {
      href: "#" + u + "fn-" + c,
      id: u + "fnref-" + c + (d > 1 ? "-" + d : ""),
      dataFootnoteRef: !0,
      ariaDescribedBy: ["footnote-label"]
    },
    children: [{ type: "text", value: String(f) }]
  };
  n.patch(a, m);
  const p = {
    type: "element",
    tagName: "sup",
    properties: {},
    children: [m]
  };
  return n.patch(a, p), n.applyData(a, p);
}
function gS(n, a) {
  const u = {
    type: "element",
    tagName: "h" + a.depth,
    properties: {},
    children: n.all(a)
  };
  return n.patch(a, u), n.applyData(a, u);
}
function yS(n, a) {
  if (n.options.allowDangerousHtml) {
    const u = { type: "raw", value: a.value };
    return n.patch(a, u), n.applyData(a, u);
  }
}
function hg(n, a) {
  const u = a.referenceType;
  let r = "]";
  if (u === "collapsed" ? r += "[]" : u === "full" && (r += "[" + (a.label || a.identifier) + "]"), a.type === "imageReference")
    return [{ type: "text", value: "![" + a.alt + r }];
  const c = n.all(a), h = c[0];
  h && h.type === "text" ? h.value = "[" + h.value : c.unshift({ type: "text", value: "[" });
  const f = c[c.length - 1];
  return f && f.type === "text" ? f.value += r : c.push({ type: "text", value: r }), c;
}
function bS(n, a) {
  const u = String(a.identifier).toUpperCase(), r = n.definitionById.get(u);
  if (!r)
    return hg(n, a);
  const c = { src: Ai(r.url || "") };
  a.alt !== null && a.alt !== void 0 && (c.alt = a.alt), r.title !== null && r.title !== void 0 && (c.title = r.title);
  const h = { type: "element", tagName: "img", properties: c, children: [] };
  return n.patch(a, h), n.applyData(a, h);
}
function vS(n, a) {
  const u = { src: Ai(a.url) };
  a.alt !== null && a.alt !== void 0 && (u.alt = a.alt), a.title !== null && a.title !== void 0 && (u.title = a.title);
  const r = { type: "element", tagName: "img", properties: u, children: [] };
  return n.patch(a, r), n.applyData(a, r);
}
function SS(n, a) {
  const u = { type: "text", value: a.value.replace(/\r?\n|\r/g, " ") };
  n.patch(a, u);
  const r = {
    type: "element",
    tagName: "code",
    properties: {},
    children: [u]
  };
  return n.patch(a, r), n.applyData(a, r);
}
function ES(n, a) {
  const u = String(a.identifier).toUpperCase(), r = n.definitionById.get(u);
  if (!r)
    return hg(n, a);
  const c = { href: Ai(r.url || "") };
  r.title !== null && r.title !== void 0 && (c.title = r.title);
  const h = {
    type: "element",
    tagName: "a",
    properties: c,
    children: n.all(a)
  };
  return n.patch(a, h), n.applyData(a, h);
}
function xS(n, a) {
  const u = { href: Ai(a.url) };
  a.title !== null && a.title !== void 0 && (u.title = a.title);
  const r = {
    type: "element",
    tagName: "a",
    properties: u,
    children: n.all(a)
  };
  return n.patch(a, r), n.applyData(a, r);
}
function TS(n, a, u) {
  const r = n.all(a), c = u ? AS(u) : dg(a), h = {}, f = [];
  if (typeof a.checked == "boolean") {
    const y = r[0];
    let b;
    y && y.type === "element" && y.tagName === "p" ? b = y : (b = { type: "element", tagName: "p", properties: {}, children: [] }, r.unshift(b)), b.children.length > 0 && b.children.unshift({ type: "text", value: " " }), b.children.unshift({
      type: "element",
      tagName: "input",
      properties: { type: "checkbox", checked: a.checked, disabled: !0 },
      children: []
    }), h.className = ["task-list-item"];
  }
  let d = -1;
  for (; ++d < r.length; ) {
    const y = r[d];
    (c || d !== 0 || y.type !== "element" || y.tagName !== "p") && f.push({ type: "text", value: `
` }), y.type === "element" && y.tagName === "p" && !c ? f.push(...y.children) : f.push(y);
  }
  const m = r[r.length - 1];
  m && (c || m.type !== "element" || m.tagName !== "p") && f.push({ type: "text", value: `
` });
  const p = { type: "element", tagName: "li", properties: h, children: f };
  return n.patch(a, p), n.applyData(a, p);
}
function AS(n) {
  let a = !1;
  if (n.type === "list") {
    a = n.spread || !1;
    const { children: u } = n;
    let r = -1;
    for (; !a && ++r < u.length; )
      a = dg(u[r]);
  }
  return a;
}
function dg(n) {
  const { spread: a } = n;
  return a ?? n.children.length > 1;
}
function CS(n, a) {
  const u = {}, r = n.all(a);
  let c = -1;
  for (typeof a.start == "number" && a.start !== 1 && (u.start = a.start); ++c < r.length; ) {
    const f = r[c];
    if (f.type === "element" && f.tagName === "li" && f.properties && Array.isArray(f.properties.className) && f.properties.className.includes("task-list-item")) {
      u.className = ["contains-task-list"];
      break;
    }
  }
  const h = {
    type: "element",
    tagName: a.ordered ? "ol" : "ul",
    properties: u,
    children: n.wrap(r, !0)
  };
  return n.patch(a, h), n.applyData(a, h);
}
function _S(n, a) {
  const u = {
    type: "element",
    tagName: "p",
    properties: {},
    children: n.all(a)
  };
  return n.patch(a, u), n.applyData(a, u);
}
function kS(n, a) {
  const u = { type: "root", children: n.wrap(n.all(a)) };
  return n.patch(a, u), n.applyData(a, u);
}
function zS(n, a) {
  const u = {
    type: "element",
    tagName: "strong",
    properties: {},
    children: n.all(a)
  };
  return n.patch(a, u), n.applyData(a, u);
}
function wS(n, a) {
  const u = n.all(a), r = u.shift(), c = [];
  if (r) {
    const f = {
      type: "element",
      tagName: "thead",
      properties: {},
      children: n.wrap([r], !0)
    };
    n.patch(a.children[0], f), c.push(f);
  }
  if (u.length > 0) {
    const f = {
      type: "element",
      tagName: "tbody",
      properties: {},
      children: n.wrap(u, !0)
    }, d = Ss(a.children[1]), m = Ym(a.children[a.children.length - 1]);
    d && m && (f.position = { start: d, end: m }), c.push(f);
  }
  const h = {
    type: "element",
    tagName: "table",
    properties: {},
    children: n.wrap(c, !0)
  };
  return n.patch(a, h), n.applyData(a, h);
}
function DS(n, a, u) {
  const r = u ? u.children : void 0, h = (r ? r.indexOf(a) : 1) === 0 ? "th" : "td", f = u && u.type === "table" ? u.align : void 0, d = f ? f.length : a.children.length;
  let m = -1;
  const p = [];
  for (; ++m < d; ) {
    const b = a.children[m], E = {}, v = f ? f[m] : void 0;
    v && (E.align = v);
    let A = { type: "element", tagName: h, properties: E, children: [] };
    b && (A.children = n.all(b), n.patch(b, A), A = n.applyData(b, A)), p.push(A);
  }
  const y = {
    type: "element",
    tagName: "tr",
    properties: {},
    children: n.wrap(p, !0)
  };
  return n.patch(a, y), n.applyData(a, y);
}
function OS(n, a) {
  const u = {
    type: "element",
    tagName: "td",
    // Assume body cell.
    properties: {},
    children: n.all(a)
  };
  return n.patch(a, u), n.applyData(a, u);
}
const sm = 9, fm = 32;
function NS(n) {
  const a = String(n), u = /\r?\n|\r/g;
  let r = u.exec(a), c = 0;
  const h = [];
  for (; r; )
    h.push(
      hm(a.slice(c, r.index), c > 0, !0),
      r[0]
    ), c = r.index + r[0].length, r = u.exec(a);
  return h.push(hm(a.slice(c), c > 0, !1)), h.join("");
}
function hm(n, a, u) {
  let r = 0, c = n.length;
  if (a) {
    let h = n.codePointAt(r);
    for (; h === sm || h === fm; )
      r++, h = n.codePointAt(r);
  }
  if (u) {
    let h = n.codePointAt(c - 1);
    for (; h === sm || h === fm; )
      c--, h = n.codePointAt(c - 1);
  }
  return c > r ? n.slice(r, c) : "";
}
function RS(n, a) {
  const u = { type: "text", value: NS(String(a.value)) };
  return n.patch(a, u), n.applyData(a, u);
}
function MS(n, a) {
  const u = {
    type: "element",
    tagName: "hr",
    properties: {},
    children: []
  };
  return n.patch(a, u), n.applyData(a, u);
}
const US = {
  blockquote: sS,
  break: fS,
  code: hS,
  delete: dS,
  emphasis: pS,
  footnoteReference: mS,
  heading: gS,
  html: yS,
  imageReference: bS,
  image: vS,
  inlineCode: SS,
  linkReference: ES,
  link: xS,
  listItem: TS,
  list: CS,
  paragraph: _S,
  // @ts-expect-error: root is different, but hard to type.
  root: kS,
  strong: zS,
  table: wS,
  tableCell: OS,
  tableRow: DS,
  text: RS,
  thematicBreak: MS,
  toml: Fu,
  yaml: Fu,
  definition: Fu,
  footnoteDefinition: Fu
};
function Fu() {
}
const pg = -1, sr = 0, za = 1, ir = 2, _s = 3, ks = 4, zs = 5, ws = 6, mg = 7, gg = 8, { defineProperty: LS } = Object, yg = typeof self == "object" ? self : globalThis, dm = (n, a) => {
  switch (n) {
    case "Function":
    case "SharedWorker":
    case "Worker":
    case "eval":
    case "setInterval":
    case "setTimeout":
      throw new TypeError("unable to deserialize " + n);
  }
  return new yg[n](a);
}, BS = (n, a) => {
  const u = (c, h) => (n.set(h, c), c), r = (c) => {
    if (n.has(c))
      return n.get(c);
    const [h, f] = a[c];
    switch (h) {
      case sr:
      case pg:
        return u(f, c);
      case za: {
        const d = u([], c);
        for (const m of f)
          d.push(r(m));
        return d;
      }
      case ir: {
        const d = u({}, c);
        for (const [m, p] of f) {
          const y = r(m), b = r(p);
          y === "__proto__" ? LS(d, y, {
            value: b,
            configurable: !0,
            enumerable: !0,
            writable: !0
          }) : d[y] = b;
        }
        return d;
      }
      case _s:
        return u(new Date(f), c);
      case ks: {
        const { source: d, flags: m } = f;
        return u(new RegExp(d, m), c);
      }
      case zs: {
        const d = u(/* @__PURE__ */ new Map(), c);
        for (const [m, p] of f)
          d.set(r(m), r(p));
        return d;
      }
      case ws: {
        const d = u(/* @__PURE__ */ new Set(), c);
        for (const m of f)
          d.add(r(m));
        return d;
      }
      case mg: {
        const { name: d, message: m } = f;
        return u(
          typeof yg[d] == "function" ? dm(d, m) : new Error(m),
          c
        );
      }
      case gg:
        return u(BigInt(f), c);
      case "BigInt":
        return u(Object(BigInt(f)), c);
      case "ArrayBuffer":
        return u(new Uint8Array(f).buffer, f);
      case "DataView": {
        const { buffer: d } = new Uint8Array(f);
        return u(new DataView(d), f);
      }
      case "-0":
        return -0;
    }
    return u(dm(h, f), c);
  };
  return r;
}, pm = (n) => BS(/* @__PURE__ */ new Map(), n)(0), wl = "", { toString: HS } = {}, { keys: jS, is: qS } = Object, Ta = (n) => {
  const a = typeof n;
  if (a !== "object" || !n)
    return [sr, a];
  const u = HS.call(n).slice(8, -1);
  switch (u) {
    case "Array":
      return [za, wl];
    case "Object":
      return [ir, wl];
    case "Date":
      return [_s, wl];
    case "RegExp":
      return [ks, wl];
    case "Map":
      return [zs, wl];
    case "Set":
      return [ws, wl];
    case "DataView":
      return [za, u];
  }
  return u.includes("Array") ? [za, u] : n instanceof Error ? [mg, n.name || "Error"] : [ir, u];
}, $u = ([n, a]) => n === sr && (a === "function" || a === "symbol"), IS = (n, a, u, r) => {
  const c = (f, d) => {
    const m = r.push(f) - 1;
    return u.set(d, m), m;
  }, h = (f) => {
    if (u.has(f))
      return u.get(f);
    let [d, m] = Ta(f);
    switch (d) {
      case sr: {
        let y = f;
        switch (m) {
          case "bigint":
            d = gg, y = f.toString();
            break;
          case "number":
            if (!f && qS(f, -0))
              return r.push(["-0"]) - 1;
            break;
          case "function":
          case "symbol":
            if (n)
              throw new TypeError("unable to serialize " + m);
            y = null;
            break;
          case "undefined":
            return c([pg], f);
        }
        return c([d, y], f);
      }
      case za: {
        if (m) {
          let E = f;
          return m === "DataView" ? E = new Uint8Array(f.buffer) : m === "ArrayBuffer" && (E = new Uint8Array(f)), c([m, [...E]], f);
        }
        const y = [], b = c([d, y], f);
        for (const E of f)
          y.push(h(E));
        return b;
      }
      case ir: {
        if (m)
          switch (m) {
            case "BigInt":
              return c([m, f.toString()], f);
            case "Boolean":
            case "Number":
            case "String":
              return c([m, f.valueOf()], f);
          }
        if (a && "toJSON" in f)
          return h(f.toJSON());
        const y = [], b = c([d, y], f);
        for (const E of jS(f))
          (n || !$u(Ta(f[E]))) && y.push([h(E), h(f[E])]);
        return b;
      }
      case _s:
        return c([d, isNaN(f.getTime()) ? wl : f.toISOString()], f);
      case ks: {
        const { source: y, flags: b } = f;
        return c([d, { source: y, flags: b }], f);
      }
      case zs: {
        const y = [], b = c([d, y], f);
        for (const [E, v] of f)
          (n || !($u(Ta(E)) || $u(Ta(v)))) && y.push([h(E), h(v)]);
        return b;
      }
      case ws: {
        const y = [], b = c([d, y], f);
        for (const E of f)
          (n || !$u(Ta(E))) && y.push(h(E));
        return b;
      }
    }
    const { message: p } = f;
    return c([d, { name: m, message: p }], f);
  };
  return h;
}, mm = (n, { json: a, lossy: u } = {}) => {
  const r = [];
  return IS(!(a || u), !!a, /* @__PURE__ */ new Map(), r)(n), r;
}, ar = typeof structuredClone == "function" ? (
  /* c8 ignore start */
  (n, a) => a && ("json" in a || "lossy" in a) ? pm(mm(n, a)) : structuredClone(n)
) : (n, a) => pm(mm(n, a));
function VS(n, a) {
  const u = [{ type: "text", value: "↩" }];
  return a > 1 && u.push({
    type: "element",
    tagName: "sup",
    properties: {},
    children: [{ type: "text", value: String(a) }]
  }), u;
}
function YS(n, a) {
  return "Back to reference " + (n + 1) + (a > 1 ? "-" + a : "");
}
function GS(n) {
  const a = typeof n.options.clobberPrefix == "string" ? n.options.clobberPrefix : "user-content-", u = n.options.footnoteBackContent || VS, r = n.options.footnoteBackLabel || YS, c = n.options.footnoteLabel || "Footnotes", h = n.options.footnoteLabelTagName || "h2", f = n.options.footnoteLabelProperties || {
    className: ["sr-only"]
  }, d = [], m = [];
  let p = -1;
  for (; ++p < n.footnoteOrder.length; ) {
    const y = n.footnoteById.get(
      n.footnoteOrder[p]
    );
    y && (d[p] = n.all(y));
  }
  for (p = -1; ++p < n.footnoteOrder.length; ) {
    const y = n.footnoteById.get(
      n.footnoteOrder[p]
    );
    if (!y)
      continue;
    const b = d[p], E = String(y.identifier).toUpperCase(), v = Ai(E.toLowerCase());
    let A = 0;
    const w = [], q = n.footnoteCounts.get(E);
    for (; q !== void 0 && ++A <= q; ) {
      w.length > 0 && w.push({ type: "text", value: " " });
      let U = typeof u == "string" ? u : u(p, A);
      typeof U == "string" && (U = { type: "text", value: U }), w.push({
        type: "element",
        tagName: "a",
        properties: {
          href: "#" + a + "fnref-" + v + (A > 1 ? "-" + A : ""),
          dataFootnoteBackref: "",
          ariaLabel: typeof r == "string" ? r : r(p, A),
          className: ["data-footnote-backref"]
        },
        children: Array.isArray(U) ? U : [U]
      });
    }
    const z = b[b.length - 1];
    if (z && z.type === "element" && z.tagName === "p") {
      const U = z.children[z.children.length - 1];
      U && U.type === "text" ? U.value += " " : z.children.push({ type: "text", value: " " }), z.children.push(...w);
    } else
      b.push(...w);
    const X = {
      type: "element",
      tagName: "li",
      properties: { id: a + "fn-" + v },
      children: n.wrap(b, !0)
    };
    n.patch(y, X), m.push(X);
  }
  if (m.length !== 0)
    return {
      type: "element",
      tagName: "section",
      properties: { dataFootnotes: !0, className: ["footnotes"] },
      children: [
        {
          type: "element",
          tagName: h,
          properties: {
            ...ar(f),
            id: "footnote-label"
          },
          children: [{ type: "text", value: c }]
        },
        { type: "text", value: `
` },
        {
          type: "element",
          tagName: "ol",
          properties: {},
          children: n.wrap(m, !0)
        },
        { type: "text", value: `
` }
      ]
    };
}
const fr = (
  // Note: overloads in JSDoc can’t yet use different `@template`s.
  /**
   * @type {(
   *   (<Condition extends string>(test: Condition) => (node: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node & {type: Condition}) &
   *   (<Condition extends Props>(test: Condition) => (node: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node & Condition) &
   *   (<Condition extends TestFunction>(test: Condition) => (node: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node & Predicate<Condition, Node>) &
   *   ((test?: null | undefined) => (node?: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node) &
   *   ((test?: Test) => Check)
   * )}
   */
  /**
   * @param {Test} [test]
   * @returns {Check}
   */
  (function(n) {
    if (n == null)
      return KS;
    if (typeof n == "function")
      return hr(n);
    if (typeof n == "object")
      return Array.isArray(n) ? QS(n) : (
        // Cast because `ReadonlyArray` goes into the above but `isArray`
        // narrows to `Array`.
        XS(
          /** @type {Props} */
          n
        )
      );
    if (typeof n == "string")
      return ZS(n);
    throw new Error("Expected function, string, or object as test");
  })
);
function QS(n) {
  const a = [];
  let u = -1;
  for (; ++u < n.length; )
    a[u] = fr(n[u]);
  return hr(r);
  function r(...c) {
    let h = -1;
    for (; ++h < a.length; )
      if (a[h].apply(this, c)) return !0;
    return !1;
  }
}
function XS(n) {
  const a = (
    /** @type {Record<string, unknown>} */
    n
  );
  return hr(u);
  function u(r) {
    const c = (
      /** @type {Record<string, unknown>} */
      /** @type {unknown} */
      r
    );
    let h;
    for (h in n)
      if (c[h] !== a[h]) return !1;
    return !0;
  }
}
function ZS(n) {
  return hr(a);
  function a(u) {
    return u && u.type === n;
  }
}
function hr(n) {
  return a;
  function a(u, r, c) {
    return !!(JS(u) && n.call(
      this,
      u,
      typeof r == "number" ? r : void 0,
      c || void 0
    ));
  }
}
function KS() {
  return !0;
}
function JS(n) {
  return n !== null && typeof n == "object" && "type" in n;
}
const bg = [], FS = !0, wa = !1, os = "skip";
function cs(n, a, u, r) {
  if (!n || typeof n != "object")
    throw new Error("Unexpected value `" + n + "` for `tree`, expected node");
  let c = !0, h, f, d, m;
  if (typeof u == "function" || u && typeof u == "object" ? (h = /** @type {Test} */
  a, f = u, r && (c = !1)) : (f = /** @type {Visitors | Visitor} */
  a, u && (c = !1)), typeof f == "function")
    d = f;
  else if (f && typeof f == "object") {
    if (!(f.enter === null || f.enter === void 0)) if (typeof f.enter == "function")
      d = f.enter;
    else
      throw new Error(
        "Unexpected value `" + f.enter + "` for `visitors.enter`, expected optional visitor"
      );
    if (typeof f.exit == "function")
      m = f.exit;
    else
      throw new Error(
        "Unexpected value `" + f.exit + "` for `visitors.exit`, expected visitor (pass a visitor directly if you only want an enter visitor)"
      );
  } else
    throw new Error(
      "Unexpected value `" + f + "` for `enter` or `visitors`, expected visitor or object with visitors"
    );
  const p = fr(h), y = c ? 1 : -1;
  b(n, void 0, [])();
  function b(E, v, A) {
    const w = (
      /** @type {Record<string, unknown>} */
      E && typeof E == "object" ? E : {}
    );
    if (typeof w.type == "string") {
      const z = (
        // `hast`
        typeof w.tagName == "string" ? w.tagName : (
          // `xast`
          typeof w.name == "string" ? w.name : void 0
        )
      );
      Object.defineProperty(q, "name", {
        value: "node (" + (E.type + (z ? "<" + z + ">" : "")) + ")"
      });
    }
    return q;
    function q() {
      const z = !h || p(E, v, A[A.length - 1] || void 0);
      let X = bg;
      if (d && z && (X = gm(d(E, A, v)), X[0] === wa))
        return X;
      if ("children" in E && E.children) {
        const U = (
          /** @type {UnistParent} */
          E
        );
        if (U.children && X[0] !== os) {
          let W = (c ? -1 : U.children.length) + y;
          const it = [...A, U];
          for (; W > -1 && W < U.children.length; ) {
            const H = U.children[W], J = b(H, W, it)();
            if (J[0] === wa)
              return J;
            W = typeof J[1] == "number" ? J[1] : W + y;
          }
        }
      }
      if (m && z) {
        const U = gm(m(E, A, v));
        if (U[0] === os)
          throw new Error(
            "Unexpected value `" + U[0] + "` from `exit`, expected `CONTINUE`, `EXIT`, index, or nothing"
          );
        if (U[0] === wa || typeof U[1] == "number")
          return U;
      }
      return X;
    }
  }
}
function gm(n) {
  return Array.isArray(n) ? n : typeof n == "number" ? [FS, n] : n == null ? bg : [n];
}
function dr(n, a, u, r) {
  let c, h, f;
  h = /** @type {Visitor | Visitors} */
  a, f = u, typeof h == "function" ? cs(n, c, ss(h), f) : cs(n, c, $S(h), f);
}
function $S(n) {
  return !n || typeof n != "object" ? n : {
    enter: typeof n.enter == "function" ? ss(n.enter) : n.enter,
    exit: typeof n.exit == "function" ? ss(n.exit) : n.exit
  };
}
function ss(n) {
  return a;
  function a(u, r, c) {
    return n(u, c, r[r.length - 1]);
  }
}
const fs = {}.hasOwnProperty, WS = {};
function PS(n, a) {
  const u = a || WS, r = /* @__PURE__ */ new Map(), c = /* @__PURE__ */ new Map(), h = /* @__PURE__ */ new Map(), f = { ...US, ...u.handlers }, d = {
    all: p,
    applyData: eE,
    definitionById: r,
    footnoteById: c,
    footnoteCounts: h,
    footnoteOrder: [],
    handlers: f,
    one: m,
    options: u,
    patch: tE,
    wrap: lE
  };
  return dr(n, function(y) {
    if (y.type === "definition" || y.type === "footnoteDefinition") {
      const b = String(y.identifier).toUpperCase();
      y.type === "definition" ? r.has(b) || r.set(b, y) : c.has(b) || c.set(b, y);
    }
  }), d;
  function m(y, b) {
    const { type: E } = y, v = d.handlers[E];
    if (fs.call(d.handlers, E) && v)
      return v(d, y, b);
    if (d.options.passThrough && d.options.passThrough.includes(E)) {
      if ("children" in y) {
        const { children: w, ...q } = y;
        return { ...ar(q), children: d.all(y) };
      }
      return ar(y);
    }
    return (d.options.unknownHandler || nE)(d, y, b);
  }
  function p(y) {
    const b = [];
    if ("children" in y) {
      const E = y.children;
      let v = -1;
      for (; ++v < E.length; ) {
        const A = d.one(E[v], y);
        if (A) {
          if (v && E[v - 1].type === "break" && (!Array.isArray(A) && A.type === "text" && (A.value = ym(A.value)), !Array.isArray(A) && A.type === "element")) {
            const w = A.children[0];
            w && w.type === "text" && (w.value = ym(w.value));
          }
          Array.isArray(A) ? b.push(...A) : b.push(A);
        }
      }
    }
    return b;
  }
}
function tE(n, a) {
  n.position && (a.position = Y0(n));
}
function eE(n, a) {
  let u = a;
  if (n && n.data) {
    const { hChildren: r, hName: c, hProperties: h } = n.data;
    if (typeof c == "string")
      if (u.type === "element")
        u.tagName = c;
      else {
        const f = "children" in u ? u.children : [u];
        u = { type: "element", tagName: c, properties: {}, children: f };
      }
    u.type === "element" && h && Object.assign(u.properties, ar(h)), "children" in u && u.children && r !== null && r !== void 0 && (u.children = r);
  }
  return u;
}
function nE(n, a) {
  const u = a.data || {}, r = "value" in a && !(fs.call(u, "hProperties") || fs.call(u, "hChildren")) ? { type: "text", value: a.value } : {
    type: "element",
    tagName: "div",
    properties: {},
    children: n.all(a)
  };
  return n.patch(a, r), n.applyData(a, r);
}
function lE(n, a) {
  const u = [];
  let r = -1;
  for (a && u.push({ type: "text", value: `
` }); ++r < n.length; )
    r && u.push({ type: "text", value: `
` }), u.push(n[r]);
  return a && n.length > 0 && u.push({ type: "text", value: `
` }), u;
}
function ym(n) {
  let a = 0, u = n.charCodeAt(a);
  for (; u === 9 || u === 32; )
    a++, u = n.charCodeAt(a);
  return n.slice(a);
}
function bm(n, a) {
  const u = PS(n, a), r = u.one(n, void 0), c = GS(u), h = Array.isArray(r) ? { type: "root", children: r } : r || { type: "root", children: [] };
  return c && h.children.push({ type: "text", value: `
` }, c), h;
}
function iE(n, a) {
  return n && "run" in n ? async function(u, r) {
    const c = (
      /** @type {HastRoot} */
      bm(u, { file: r, ...a })
    );
    await n.run(c, r);
  } : function(u, r) {
    return (
      /** @type {HastRoot} */
      bm(u, { file: r, ...n || a })
    );
  };
}
function vm(n) {
  if (n)
    throw n;
}
var Vc, Sm;
function aE() {
  if (Sm) return Vc;
  Sm = 1;
  var n = Object.prototype.hasOwnProperty, a = Object.prototype.toString, u = Object.defineProperty, r = Object.getOwnPropertyDescriptor, c = function(p) {
    return typeof Array.isArray == "function" ? Array.isArray(p) : a.call(p) === "[object Array]";
  }, h = function(p) {
    if (!p || a.call(p) !== "[object Object]")
      return !1;
    var y = n.call(p, "constructor"), b = p.constructor && p.constructor.prototype && n.call(p.constructor.prototype, "isPrototypeOf");
    if (p.constructor && !y && !b)
      return !1;
    var E;
    for (E in p)
      ;
    return typeof E > "u" || n.call(p, E);
  }, f = function(p, y) {
    u && y.name === "__proto__" ? u(p, y.name, {
      enumerable: !0,
      configurable: !0,
      value: y.newValue,
      writable: !0
    }) : p[y.name] = y.newValue;
  }, d = function(p, y) {
    if (y === "__proto__")
      if (n.call(p, y)) {
        if (r)
          return r(p, y).value;
      } else return;
    return p[y];
  };
  return Vc = function m() {
    var p, y, b, E, v, A, w = arguments[0], q = 1, z = arguments.length, X = !1;
    for (typeof w == "boolean" && (X = w, w = arguments[1] || {}, q = 2), (w == null || typeof w != "object" && typeof w != "function") && (w = {}); q < z; ++q)
      if (p = arguments[q], p != null)
        for (y in p)
          b = d(w, y), E = d(p, y), w !== E && (X && E && (h(E) || (v = c(E))) ? (v ? (v = !1, A = b && c(b) ? b : []) : A = b && h(b) ? b : {}, f(w, { name: y, newValue: m(X, A, E) })) : typeof E < "u" && f(w, { name: y, newValue: E }));
    return w;
  }, Vc;
}
var uE = aE();
const Yc = /* @__PURE__ */ i0(uE);
function hs(n) {
  if (typeof n != "object" || n === null)
    return !1;
  const a = Object.getPrototypeOf(n);
  return (a === null || a === Object.prototype || Object.getPrototypeOf(a) === null) && !(Symbol.toStringTag in n) && !(Symbol.iterator in n);
}
function rE() {
  const n = [], a = { run: u, use: r };
  return a;
  function u(...c) {
    let h = -1;
    const f = c.pop();
    if (typeof f != "function")
      throw new TypeError("Expected function as last argument, not " + f);
    d(null, ...c);
    function d(m, ...p) {
      const y = n[++h];
      let b = -1;
      if (m) {
        f(m);
        return;
      }
      for (; ++b < c.length; )
        (p[b] === null || p[b] === void 0) && (p[b] = c[b]);
      c = p, y ? oE(y, d)(...p) : f(null, ...p);
    }
  }
  function r(c) {
    if (typeof c != "function")
      throw new TypeError(
        "Expected `middelware` to be a function, not " + c
      );
    return n.push(c), a;
  }
}
function oE(n, a) {
  let u;
  return r;
  function r(...f) {
    const d = n.length > f.length;
    let m;
    d && f.push(c);
    try {
      m = n.apply(this, f);
    } catch (p) {
      const y = (
        /** @type {Error} */
        p
      );
      if (d && u)
        throw y;
      return c(y);
    }
    d || (m && m.then && typeof m.then == "function" ? m.then(h, c) : m instanceof Error ? c(m) : h(m));
  }
  function c(f, ...d) {
    u || (u = !0, a(f, ...d));
  }
  function h(f) {
    c(null, f);
  }
}
const hn = { basename: cE, dirname: sE, extname: fE, join: hE, sep: "/" };
function cE(n, a) {
  if (a !== void 0 && typeof a != "string")
    throw new TypeError('"ext" argument must be a string');
  Ma(n);
  let u = 0, r = -1, c = n.length, h;
  if (a === void 0 || a.length === 0 || a.length > n.length) {
    for (; c--; )
      if (n.codePointAt(c) === 47) {
        if (h) {
          u = c + 1;
          break;
        }
      } else r < 0 && (h = !0, r = c + 1);
    return r < 0 ? "" : n.slice(u, r);
  }
  if (a === n)
    return "";
  let f = -1, d = a.length - 1;
  for (; c--; )
    if (n.codePointAt(c) === 47) {
      if (h) {
        u = c + 1;
        break;
      }
    } else
      f < 0 && (h = !0, f = c + 1), d > -1 && (n.codePointAt(c) === a.codePointAt(d--) ? d < 0 && (r = c) : (d = -1, r = f));
  return u === r ? r = f : r < 0 && (r = n.length), n.slice(u, r);
}
function sE(n) {
  if (Ma(n), n.length === 0)
    return ".";
  let a = -1, u = n.length, r;
  for (; --u; )
    if (n.codePointAt(u) === 47) {
      if (r) {
        a = u;
        break;
      }
    } else r || (r = !0);
  return a < 0 ? n.codePointAt(0) === 47 ? "/" : "." : a === 1 && n.codePointAt(0) === 47 ? "//" : n.slice(0, a);
}
function fE(n) {
  Ma(n);
  let a = n.length, u = -1, r = 0, c = -1, h = 0, f;
  for (; a--; ) {
    const d = n.codePointAt(a);
    if (d === 47) {
      if (f) {
        r = a + 1;
        break;
      }
      continue;
    }
    u < 0 && (f = !0, u = a + 1), d === 46 ? c < 0 ? c = a : h !== 1 && (h = 1) : c > -1 && (h = -1);
  }
  return c < 0 || u < 0 || // We saw a non-dot character immediately before the dot.
  h === 0 || // The (right-most) trimmed path component is exactly `..`.
  h === 1 && c === u - 1 && c === r + 1 ? "" : n.slice(c, u);
}
function hE(...n) {
  let a = -1, u;
  for (; ++a < n.length; )
    Ma(n[a]), n[a] && (u = u === void 0 ? n[a] : u + "/" + n[a]);
  return u === void 0 ? "." : dE(u);
}
function dE(n) {
  Ma(n);
  const a = n.codePointAt(0) === 47;
  let u = pE(n, !a);
  return u.length === 0 && !a && (u = "."), u.length > 0 && n.codePointAt(n.length - 1) === 47 && (u += "/"), a ? "/" + u : u;
}
function pE(n, a) {
  let u = "", r = 0, c = -1, h = 0, f = -1, d, m;
  for (; ++f <= n.length; ) {
    if (f < n.length)
      d = n.codePointAt(f);
    else {
      if (d === 47)
        break;
      d = 47;
    }
    if (d === 47) {
      if (!(c === f - 1 || h === 1)) if (c !== f - 1 && h === 2) {
        if (u.length < 2 || r !== 2 || u.codePointAt(u.length - 1) !== 46 || u.codePointAt(u.length - 2) !== 46) {
          if (u.length > 2) {
            if (m = u.lastIndexOf("/"), m !== u.length - 1) {
              m < 0 ? (u = "", r = 0) : (u = u.slice(0, m), r = u.length - 1 - u.lastIndexOf("/")), c = f, h = 0;
              continue;
            }
          } else if (u.length > 0) {
            u = "", r = 0, c = f, h = 0;
            continue;
          }
        }
        a && (u = u.length > 0 ? u + "/.." : "..", r = 2);
      } else
        u.length > 0 ? u += "/" + n.slice(c + 1, f) : u = n.slice(c + 1, f), r = f - c - 1;
      c = f, h = 0;
    } else d === 46 && h > -1 ? h++ : h = -1;
  }
  return u;
}
function Ma(n) {
  if (typeof n != "string")
    throw new TypeError(
      "Path must be a string. Received " + JSON.stringify(n)
    );
}
const mE = { cwd: gE };
function gE() {
  return "/";
}
function ds(n) {
  return !!(n !== null && typeof n == "object" && "href" in n && n.href && "protocol" in n && n.protocol && // @ts-expect-error: indexing is fine.
  n.auth === void 0);
}
function yE(n) {
  if (typeof n == "string")
    n = new URL(n);
  else if (!ds(n)) {
    const a = new TypeError(
      'The "path" argument must be of type string or an instance of URL. Received `' + n + "`"
    );
    throw a.code = "ERR_INVALID_ARG_TYPE", a;
  }
  if (n.protocol !== "file:") {
    const a = new TypeError("The URL must be of scheme file");
    throw a.code = "ERR_INVALID_URL_SCHEME", a;
  }
  return bE(n);
}
function bE(n) {
  if (n.hostname !== "") {
    const r = new TypeError(
      'File URL host must be "localhost" or empty on darwin'
    );
    throw r.code = "ERR_INVALID_FILE_URL_HOST", r;
  }
  const a = n.pathname;
  let u = -1;
  for (; ++u < a.length; )
    if (a.codePointAt(u) === 37 && a.codePointAt(u + 1) === 50) {
      const r = a.codePointAt(u + 2);
      if (r === 70 || r === 102) {
        const c = new TypeError(
          "File URL path must not include encoded / characters"
        );
        throw c.code = "ERR_INVALID_FILE_URL_PATH", c;
      }
    }
  return decodeURIComponent(a);
}
const Gc = (
  /** @type {const} */
  [
    "history",
    "path",
    "basename",
    "stem",
    "extname",
    "dirname"
  ]
);
class vg {
  /**
   * Create a new virtual file.
   *
   * `options` is treated as:
   *
   * *   `string` or `Uint8Array` — `{value: options}`
   * *   `URL` — `{path: options}`
   * *   `VFile` — shallow copies its data over to the new file
   * *   `object` — all fields are shallow copied over to the new file
   *
   * Path related fields are set in the following order (least specific to
   * most specific): `history`, `path`, `basename`, `stem`, `extname`,
   * `dirname`.
   *
   * You cannot set `dirname` or `extname` without setting either `history`,
   * `path`, `basename`, or `stem` too.
   *
   * @param {Compatible | null | undefined} [value]
   *   File value.
   * @returns
   *   New instance.
   */
  constructor(a) {
    let u;
    a ? ds(a) ? u = { path: a } : typeof a == "string" || vE(a) ? u = { value: a } : u = a : u = {}, this.cwd = "cwd" in u ? "" : mE.cwd(), this.data = {}, this.history = [], this.messages = [], this.value, this.map, this.result, this.stored;
    let r = -1;
    for (; ++r < Gc.length; ) {
      const h = Gc[r];
      h in u && u[h] !== void 0 && u[h] !== null && (this[h] = h === "history" ? [...u[h]] : u[h]);
    }
    let c;
    for (c in u)
      Gc.includes(c) || (this[c] = u[c]);
  }
  /**
   * Get the basename (including extname) (example: `'index.min.js'`).
   *
   * @returns {string | undefined}
   *   Basename.
   */
  get basename() {
    return typeof this.path == "string" ? hn.basename(this.path) : void 0;
  }
  /**
   * Set basename (including extname) (`'index.min.js'`).
   *
   * Cannot contain path separators (`'/'` on unix, macOS, and browsers, `'\'`
   * on windows).
   * Cannot be nullified (use `file.path = file.dirname` instead).
   *
   * @param {string} basename
   *   Basename.
   * @returns {undefined}
   *   Nothing.
   */
  set basename(a) {
    Xc(a, "basename"), Qc(a, "basename"), this.path = hn.join(this.dirname || "", a);
  }
  /**
   * Get the parent path (example: `'~'`).
   *
   * @returns {string | undefined}
   *   Dirname.
   */
  get dirname() {
    return typeof this.path == "string" ? hn.dirname(this.path) : void 0;
  }
  /**
   * Set the parent path (example: `'~'`).
   *
   * Cannot be set if there’s no `path` yet.
   *
   * @param {string | undefined} dirname
   *   Dirname.
   * @returns {undefined}
   *   Nothing.
   */
  set dirname(a) {
    Em(this.basename, "dirname"), this.path = hn.join(a || "", this.basename);
  }
  /**
   * Get the extname (including dot) (example: `'.js'`).
   *
   * @returns {string | undefined}
   *   Extname.
   */
  get extname() {
    return typeof this.path == "string" ? hn.extname(this.path) : void 0;
  }
  /**
   * Set the extname (including dot) (example: `'.js'`).
   *
   * Cannot contain path separators (`'/'` on unix, macOS, and browsers, `'\'`
   * on windows).
   * Cannot be set if there’s no `path` yet.
   *
   * @param {string | undefined} extname
   *   Extname.
   * @returns {undefined}
   *   Nothing.
   */
  set extname(a) {
    if (Qc(a, "extname"), Em(this.dirname, "extname"), a) {
      if (a.codePointAt(0) !== 46)
        throw new Error("`extname` must start with `.`");
      if (a.includes(".", 1))
        throw new Error("`extname` cannot contain multiple dots");
    }
    this.path = hn.join(this.dirname, this.stem + (a || ""));
  }
  /**
   * Get the full path (example: `'~/index.min.js'`).
   *
   * @returns {string}
   *   Path.
   */
  get path() {
    return this.history[this.history.length - 1];
  }
  /**
   * Set the full path (example: `'~/index.min.js'`).
   *
   * Cannot be nullified.
   * You can set a file URL (a `URL` object with a `file:` protocol) which will
   * be turned into a path with `url.fileURLToPath`.
   *
   * @param {URL | string} path
   *   Path.
   * @returns {undefined}
   *   Nothing.
   */
  set path(a) {
    ds(a) && (a = yE(a)), Xc(a, "path"), this.path !== a && this.history.push(a);
  }
  /**
   * Get the stem (basename w/o extname) (example: `'index.min'`).
   *
   * @returns {string | undefined}
   *   Stem.
   */
  get stem() {
    return typeof this.path == "string" ? hn.basename(this.path, this.extname) : void 0;
  }
  /**
   * Set the stem (basename w/o extname) (example: `'index.min'`).
   *
   * Cannot contain path separators (`'/'` on unix, macOS, and browsers, `'\'`
   * on windows).
   * Cannot be nullified (use `file.path = file.dirname` instead).
   *
   * @param {string} stem
   *   Stem.
   * @returns {undefined}
   *   Nothing.
   */
  set stem(a) {
    Xc(a, "stem"), Qc(a, "stem"), this.path = hn.join(this.dirname || "", a + (this.extname || ""));
  }
  // Normal prototypal methods.
  /**
   * Create a fatal message for `reason` associated with the file.
   *
   * The `fatal` field of the message is set to `true` (error; file not usable)
   * and the `file` field is set to the current file path.
   * The message is added to the `messages` field on `file`.
   *
   * > 🪦 **Note**: also has obsolete signatures.
   *
   * @overload
   * @param {string} reason
   * @param {MessageOptions | null | undefined} [options]
   * @returns {never}
   *
   * @overload
   * @param {string} reason
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @overload
   * @param {string} reason
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @overload
   * @param {string} reason
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @param {Error | VFileMessage | string} causeOrReason
   *   Reason for message, should use markdown.
   * @param {Node | NodeLike | MessageOptions | Point | Position | string | null | undefined} [optionsOrParentOrPlace]
   *   Configuration (optional).
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (example:
   *   `'my-package:my-rule'` or `'my-rule'`).
   * @returns {never}
   *   Never.
   * @throws {VFileMessage}
   *   Message.
   */
  fail(a, u, r) {
    const c = this.message(a, u, r);
    throw c.fatal = !0, c;
  }
  /**
   * Create an info message for `reason` associated with the file.
   *
   * The `fatal` field of the message is set to `undefined` (info; change
   * likely not needed) and the `file` field is set to the current file path.
   * The message is added to the `messages` field on `file`.
   *
   * > 🪦 **Note**: also has obsolete signatures.
   *
   * @overload
   * @param {string} reason
   * @param {MessageOptions | null | undefined} [options]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @param {Error | VFileMessage | string} causeOrReason
   *   Reason for message, should use markdown.
   * @param {Node | NodeLike | MessageOptions | Point | Position | string | null | undefined} [optionsOrParentOrPlace]
   *   Configuration (optional).
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (example:
   *   `'my-package:my-rule'` or `'my-rule'`).
   * @returns {VFileMessage}
   *   Message.
   */
  info(a, u, r) {
    const c = this.message(a, u, r);
    return c.fatal = void 0, c;
  }
  /**
   * Create a message for `reason` associated with the file.
   *
   * The `fatal` field of the message is set to `false` (warning; change may be
   * needed) and the `file` field is set to the current file path.
   * The message is added to the `messages` field on `file`.
   *
   * > 🪦 **Note**: also has obsolete signatures.
   *
   * @overload
   * @param {string} reason
   * @param {MessageOptions | null | undefined} [options]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @param {Error | VFileMessage | string} causeOrReason
   *   Reason for message, should use markdown.
   * @param {Node | NodeLike | MessageOptions | Point | Position | string | null | undefined} [optionsOrParentOrPlace]
   *   Configuration (optional).
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (example:
   *   `'my-package:my-rule'` or `'my-rule'`).
   * @returns {VFileMessage}
   *   Message.
   */
  message(a, u, r) {
    const c = new rr(
      // @ts-expect-error: the overloads are fine.
      a,
      u,
      r
    );
    return this.path && (c.name = this.path + ":" + c.name, c.file = this.path), c.fatal = !1, this.messages.push(c), c;
  }
  /**
   * Serialize the file.
   *
   * > **Note**: which encodings are supported depends on the engine.
   * > For info on Node.js, see:
   * > <https://nodejs.org/api/util.html#whatwg-supported-encodings>.
   *
   * @param {string | null | undefined} [encoding='utf8']
   *   Character encoding to understand `value` as when it’s a `Uint8Array`
   *   (default: `'utf-8'`).
   * @returns {string}
   *   Serialized file.
   */
  toString(a) {
    return this.value === void 0 ? "" : typeof this.value == "string" ? this.value : new TextDecoder(a || void 0).decode(this.value);
  }
}
function Qc(n, a) {
  if (n && n.includes(hn.sep))
    throw new Error(
      "`" + a + "` cannot be a path: did not expect `" + hn.sep + "`"
    );
}
function Xc(n, a) {
  if (!n)
    throw new Error("`" + a + "` cannot be empty");
}
function Em(n, a) {
  if (!n)
    throw new Error("Setting `" + a + "` requires `path` to be set too");
}
function vE(n) {
  return !!(n && typeof n == "object" && "byteLength" in n && "byteOffset" in n);
}
const SE = (
  /**
   * @type {new <Parameters extends Array<unknown>, Result>(property: string | symbol) => (...parameters: Parameters) => Result}
   */
  /** @type {unknown} */
  /**
   * @this {Function}
   * @param {string | symbol} property
   * @returns {(...parameters: Array<unknown>) => unknown}
   */
  (function(n) {
    const r = (
      /** @type {Record<string | symbol, Function>} */
      // Prototypes do exist.
      // type-coverage:ignore-next-line
      this.constructor.prototype
    ), c = r[n], h = function() {
      return c.apply(h, arguments);
    };
    return Object.setPrototypeOf(h, r), h;
  })
), EE = {}.hasOwnProperty;
class Ds extends SE {
  /**
   * Create a processor.
   */
  constructor() {
    super("copy"), this.Compiler = void 0, this.Parser = void 0, this.attachers = [], this.compiler = void 0, this.freezeIndex = -1, this.frozen = void 0, this.namespace = {}, this.parser = void 0, this.transformers = rE();
  }
  /**
   * Copy a processor.
   *
   * @deprecated
   *   This is a private internal method and should not be used.
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *   New *unfrozen* processor ({@linkcode Processor}) that is
   *   configured to work the same as its ancestor.
   *   When the descendant processor is configured in the future it does not
   *   affect the ancestral processor.
   */
  copy() {
    const a = (
      /** @type {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>} */
      new Ds()
    );
    let u = -1;
    for (; ++u < this.attachers.length; ) {
      const r = this.attachers[u];
      a.use(...r);
    }
    return a.data(Yc(!0, {}, this.namespace)), a;
  }
  /**
   * Configure the processor with info available to all plugins.
   * Information is stored in an object.
   *
   * Typically, options can be given to a specific plugin, but sometimes it
   * makes sense to have information shared with several plugins.
   * For example, a list of HTML elements that are self-closing, which is
   * needed during all phases.
   *
   * > **Note**: setting information cannot occur on *frozen* processors.
   * > Call the processor first to create a new unfrozen processor.
   *
   * > **Note**: to register custom data in TypeScript, augment the
   * > {@linkcode Data} interface.
   *
   * @example
   *   This example show how to get and set info:
   *
   *   ```js
   *   import {unified} from 'unified'
   *
   *   const processor = unified().data('alpha', 'bravo')
   *
   *   processor.data('alpha') // => 'bravo'
   *
   *   processor.data() // => {alpha: 'bravo'}
   *
   *   processor.data({charlie: 'delta'})
   *
   *   processor.data() // => {charlie: 'delta'}
   *   ```
   *
   * @template {keyof Data} Key
   *
   * @overload
   * @returns {Data}
   *
   * @overload
   * @param {Data} dataset
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *
   * @overload
   * @param {Key} key
   * @returns {Data[Key]}
   *
   * @overload
   * @param {Key} key
   * @param {Data[Key]} value
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *
   * @param {Data | Key} [key]
   *   Key to get or set, or entire dataset to set, or nothing to get the
   *   entire dataset (optional).
   * @param {Data[Key]} [value]
   *   Value to set (optional).
   * @returns {unknown}
   *   The current processor when setting, the value at `key` when getting, or
   *   the entire dataset when getting without key.
   */
  data(a, u) {
    return typeof a == "string" ? arguments.length === 2 ? (Jc("data", this.frozen), this.namespace[a] = u, this) : EE.call(this.namespace, a) && this.namespace[a] || void 0 : a ? (Jc("data", this.frozen), this.namespace = a, this) : this.namespace;
  }
  /**
   * Freeze a processor.
   *
   * Frozen processors are meant to be extended and not to be configured
   * directly.
   *
   * When a processor is frozen it cannot be unfrozen.
   * New processors working the same way can be created by calling the
   * processor.
   *
   * It’s possible to freeze processors explicitly by calling `.freeze()`.
   * Processors freeze automatically when `.parse()`, `.run()`, `.runSync()`,
   * `.stringify()`, `.process()`, or `.processSync()` are called.
   *
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *   The current processor.
   */
  freeze() {
    if (this.frozen)
      return this;
    const a = (
      /** @type {Processor} */
      /** @type {unknown} */
      this
    );
    for (; ++this.freezeIndex < this.attachers.length; ) {
      const [u, ...r] = this.attachers[this.freezeIndex];
      if (r[0] === !1)
        continue;
      r[0] === !0 && (r[0] = void 0);
      const c = u.call(a, ...r);
      typeof c == "function" && this.transformers.use(c);
    }
    return this.frozen = !0, this.freezeIndex = Number.POSITIVE_INFINITY, this;
  }
  /**
   * Parse text to a syntax tree.
   *
   * > **Note**: `parse` freezes the processor if not already *frozen*.
   *
   * > **Note**: `parse` performs the parse phase, not the run phase or other
   * > phases.
   *
   * @param {Compatible | undefined} [file]
   *   file to parse (optional); typically `string` or `VFile`; any value
   *   accepted as `x` in `new VFile(x)`.
   * @returns {ParseTree extends undefined ? Node : ParseTree}
   *   Syntax tree representing `file`.
   */
  parse(a) {
    this.freeze();
    const u = Wu(a), r = this.parser || this.Parser;
    return Zc("parse", r), r(String(u), u);
  }
  /**
   * Process the given file as configured on the processor.
   *
   * > **Note**: `process` freezes the processor if not already *frozen*.
   *
   * > **Note**: `process` performs the parse, run, and stringify phases.
   *
   * @overload
   * @param {Compatible | undefined} file
   * @param {ProcessCallback<VFileWithOutput<CompileResult>>} done
   * @returns {undefined}
   *
   * @overload
   * @param {Compatible | undefined} [file]
   * @returns {Promise<VFileWithOutput<CompileResult>>}
   *
   * @param {Compatible | undefined} [file]
   *   File (optional); typically `string` or `VFile`]; any value accepted as
   *   `x` in `new VFile(x)`.
   * @param {ProcessCallback<VFileWithOutput<CompileResult>> | undefined} [done]
   *   Callback (optional).
   * @returns {Promise<VFile> | undefined}
   *   Nothing if `done` is given.
   *   Otherwise a promise, rejected with a fatal error or resolved with the
   *   processed file.
   *
   *   The parsed, transformed, and compiled value is available at
   *   `file.value` (see note).
   *
   *   > **Note**: unified typically compiles by serializing: most
   *   > compilers return `string` (or `Uint8Array`).
   *   > Some compilers, such as the one configured with
   *   > [`rehype-react`][rehype-react], return other values (in this case, a
   *   > React tree).
   *   > If you’re using a compiler that doesn’t serialize, expect different
   *   > result values.
   *   >
   *   > To register custom results in TypeScript, add them to
   *   > {@linkcode CompileResultMap}.
   *
   *   [rehype-react]: https://github.com/rehypejs/rehype-react
   */
  process(a, u) {
    const r = this;
    return this.freeze(), Zc("process", this.parser || this.Parser), Kc("process", this.compiler || this.Compiler), u ? c(void 0, u) : new Promise(c);
    function c(h, f) {
      const d = Wu(a), m = (
        /** @type {HeadTree extends undefined ? Node : HeadTree} */
        /** @type {unknown} */
        r.parse(d)
      );
      r.run(m, d, function(y, b, E) {
        if (y || !b || !E)
          return p(y);
        const v = (
          /** @type {CompileTree extends undefined ? Node : CompileTree} */
          /** @type {unknown} */
          b
        ), A = r.stringify(v, E);
        AE(A) ? E.value = A : E.result = A, p(
          y,
          /** @type {VFileWithOutput<CompileResult>} */
          E
        );
      });
      function p(y, b) {
        y || !b ? f(y) : h ? h(b) : u(void 0, b);
      }
    }
  }
  /**
   * Process the given file as configured on the processor.
   *
   * An error is thrown if asynchronous transforms are configured.
   *
   * > **Note**: `processSync` freezes the processor if not already *frozen*.
   *
   * > **Note**: `processSync` performs the parse, run, and stringify phases.
   *
   * @param {Compatible | undefined} [file]
   *   File (optional); typically `string` or `VFile`; any value accepted as
   *   `x` in `new VFile(x)`.
   * @returns {VFileWithOutput<CompileResult>}
   *   The processed file.
   *
   *   The parsed, transformed, and compiled value is available at
   *   `file.value` (see note).
   *
   *   > **Note**: unified typically compiles by serializing: most
   *   > compilers return `string` (or `Uint8Array`).
   *   > Some compilers, such as the one configured with
   *   > [`rehype-react`][rehype-react], return other values (in this case, a
   *   > React tree).
   *   > If you’re using a compiler that doesn’t serialize, expect different
   *   > result values.
   *   >
   *   > To register custom results in TypeScript, add them to
   *   > {@linkcode CompileResultMap}.
   *
   *   [rehype-react]: https://github.com/rehypejs/rehype-react
   */
  processSync(a) {
    let u = !1, r;
    return this.freeze(), Zc("processSync", this.parser || this.Parser), Kc("processSync", this.compiler || this.Compiler), this.process(a, c), Tm("processSync", "process", u), r;
    function c(h, f) {
      u = !0, vm(h), r = f;
    }
  }
  /**
   * Run *transformers* on a syntax tree.
   *
   * > **Note**: `run` freezes the processor if not already *frozen*.
   *
   * > **Note**: `run` performs the run phase, not other phases.
   *
   * @overload
   * @param {HeadTree extends undefined ? Node : HeadTree} tree
   * @param {RunCallback<TailTree extends undefined ? Node : TailTree>} done
   * @returns {undefined}
   *
   * @overload
   * @param {HeadTree extends undefined ? Node : HeadTree} tree
   * @param {Compatible | undefined} file
   * @param {RunCallback<TailTree extends undefined ? Node : TailTree>} done
   * @returns {undefined}
   *
   * @overload
   * @param {HeadTree extends undefined ? Node : HeadTree} tree
   * @param {Compatible | undefined} [file]
   * @returns {Promise<TailTree extends undefined ? Node : TailTree>}
   *
   * @param {HeadTree extends undefined ? Node : HeadTree} tree
   *   Tree to transform and inspect.
   * @param {(
   *   RunCallback<TailTree extends undefined ? Node : TailTree> |
   *   Compatible
   * )} [file]
   *   File associated with `node` (optional); any value accepted as `x` in
   *   `new VFile(x)`.
   * @param {RunCallback<TailTree extends undefined ? Node : TailTree>} [done]
   *   Callback (optional).
   * @returns {Promise<TailTree extends undefined ? Node : TailTree> | undefined}
   *   Nothing if `done` is given.
   *   Otherwise, a promise rejected with a fatal error or resolved with the
   *   transformed tree.
   */
  run(a, u, r) {
    xm(a), this.freeze();
    const c = this.transformers;
    return !r && typeof u == "function" && (r = u, u = void 0), r ? h(void 0, r) : new Promise(h);
    function h(f, d) {
      const m = Wu(u);
      c.run(a, m, p);
      function p(y, b, E) {
        const v = (
          /** @type {TailTree extends undefined ? Node : TailTree} */
          b || a
        );
        y ? d(y) : f ? f(v) : r(void 0, v, E);
      }
    }
  }
  /**
   * Run *transformers* on a syntax tree.
   *
   * An error is thrown if asynchronous transforms are configured.
   *
   * > **Note**: `runSync` freezes the processor if not already *frozen*.
   *
   * > **Note**: `runSync` performs the run phase, not other phases.
   *
   * @param {HeadTree extends undefined ? Node : HeadTree} tree
   *   Tree to transform and inspect.
   * @param {Compatible | undefined} [file]
   *   File associated with `node` (optional); any value accepted as `x` in
   *   `new VFile(x)`.
   * @returns {TailTree extends undefined ? Node : TailTree}
   *   Transformed tree.
   */
  runSync(a, u) {
    let r = !1, c;
    return this.run(a, u, h), Tm("runSync", "run", r), c;
    function h(f, d) {
      vm(f), c = d, r = !0;
    }
  }
  /**
   * Compile a syntax tree.
   *
   * > **Note**: `stringify` freezes the processor if not already *frozen*.
   *
   * > **Note**: `stringify` performs the stringify phase, not the run phase
   * > or other phases.
   *
   * @param {CompileTree extends undefined ? Node : CompileTree} tree
   *   Tree to compile.
   * @param {Compatible | undefined} [file]
   *   File associated with `node` (optional); any value accepted as `x` in
   *   `new VFile(x)`.
   * @returns {CompileResult extends undefined ? Value : CompileResult}
   *   Textual representation of the tree (see note).
   *
   *   > **Note**: unified typically compiles by serializing: most compilers
   *   > return `string` (or `Uint8Array`).
   *   > Some compilers, such as the one configured with
   *   > [`rehype-react`][rehype-react], return other values (in this case, a
   *   > React tree).
   *   > If you’re using a compiler that doesn’t serialize, expect different
   *   > result values.
   *   >
   *   > To register custom results in TypeScript, add them to
   *   > {@linkcode CompileResultMap}.
   *
   *   [rehype-react]: https://github.com/rehypejs/rehype-react
   */
  stringify(a, u) {
    this.freeze();
    const r = Wu(u), c = this.compiler || this.Compiler;
    return Kc("stringify", c), xm(a), c(a, r);
  }
  /**
   * Configure the processor to use a plugin, a list of usable values, or a
   * preset.
   *
   * If the processor is already using a plugin, the previous plugin
   * configuration is changed based on the options that are passed in.
   * In other words, the plugin is not added a second time.
   *
   * > **Note**: `use` cannot be called on *frozen* processors.
   * > Call the processor first to create a new unfrozen processor.
   *
   * @example
   *   There are many ways to pass plugins to `.use()`.
   *   This example gives an overview:
   *
   *   ```js
   *   import {unified} from 'unified'
   *
   *   unified()
   *     // Plugin with options:
   *     .use(pluginA, {x: true, y: true})
   *     // Passing the same plugin again merges configuration (to `{x: true, y: false, z: true}`):
   *     .use(pluginA, {y: false, z: true})
   *     // Plugins:
   *     .use([pluginB, pluginC])
   *     // Two plugins, the second with options:
   *     .use([pluginD, [pluginE, {}]])
   *     // Preset with plugins and settings:
   *     .use({plugins: [pluginF, [pluginG, {}]], settings: {position: false}})
   *     // Settings only:
   *     .use({settings: {position: false}})
   *   ```
   *
   * @template {Array<unknown>} [Parameters=[]]
   * @template {Node | string | undefined} [Input=undefined]
   * @template [Output=Input]
   *
   * @overload
   * @param {Preset | null | undefined} [preset]
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *
   * @overload
   * @param {PluggableList} list
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *
   * @overload
   * @param {Plugin<Parameters, Input, Output>} plugin
   * @param {...(Parameters | [boolean])} parameters
   * @returns {UsePlugin<ParseTree, HeadTree, TailTree, CompileTree, CompileResult, Input, Output>}
   *
   * @param {PluggableList | Plugin | Preset | null | undefined} value
   *   Usable value.
   * @param {...unknown} parameters
   *   Parameters, when a plugin is given as a usable value.
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *   Current processor.
   */
  use(a, ...u) {
    const r = this.attachers, c = this.namespace;
    if (Jc("use", this.frozen), a != null) if (typeof a == "function")
      m(a, u);
    else if (typeof a == "object")
      Array.isArray(a) ? d(a) : f(a);
    else
      throw new TypeError("Expected usable value, not `" + a + "`");
    return this;
    function h(p) {
      if (typeof p == "function")
        m(p, []);
      else if (typeof p == "object")
        if (Array.isArray(p)) {
          const [y, ...b] = (
            /** @type {PluginTuple<Array<unknown>>} */
            p
          );
          m(y, b);
        } else
          f(p);
      else
        throw new TypeError("Expected usable value, not `" + p + "`");
    }
    function f(p) {
      if (!("plugins" in p) && !("settings" in p))
        throw new Error(
          "Expected usable value but received an empty preset, which is probably a mistake: presets typically come with `plugins` and sometimes with `settings`, but this has neither"
        );
      d(p.plugins), p.settings && (c.settings = Yc(!0, c.settings, p.settings));
    }
    function d(p) {
      let y = -1;
      if (p != null) if (Array.isArray(p))
        for (; ++y < p.length; ) {
          const b = p[y];
          h(b);
        }
      else
        throw new TypeError("Expected a list of plugins, not `" + p + "`");
    }
    function m(p, y) {
      let b = -1, E = -1;
      for (; ++b < r.length; )
        if (r[b][0] === p) {
          E = b;
          break;
        }
      if (E === -1)
        r.push([p, ...y]);
      else if (y.length > 0) {
        let [v, ...A] = y;
        const w = r[E][1];
        hs(w) && hs(v) && (v = Yc(!0, w, v)), r[E] = [p, v, ...A];
      }
    }
  }
}
const xE = new Ds().freeze();
function Zc(n, a) {
  if (typeof a != "function")
    throw new TypeError("Cannot `" + n + "` without `parser`");
}
function Kc(n, a) {
  if (typeof a != "function")
    throw new TypeError("Cannot `" + n + "` without `compiler`");
}
function Jc(n, a) {
  if (a)
    throw new Error(
      "Cannot call `" + n + "` on a frozen processor.\nCreate a new processor first, by calling it: use `processor()` instead of `processor`."
    );
}
function xm(n) {
  if (!hs(n) || typeof n.type != "string")
    throw new TypeError("Expected node, got `" + n + "`");
}
function Tm(n, a, u) {
  if (!u)
    throw new Error(
      "`" + n + "` finished async. Use `" + a + "` instead"
    );
}
function Wu(n) {
  return TE(n) ? n : new vg(n);
}
function TE(n) {
  return !!(n && typeof n == "object" && "message" in n && "messages" in n);
}
function AE(n) {
  return typeof n == "string" || CE(n);
}
function CE(n) {
  return !!(n && typeof n == "object" && "byteLength" in n && "byteOffset" in n);
}
const _E = "https://github.com/remarkjs/react-markdown/blob/main/changelog.md", Am = [], Cm = { allowDangerousHtml: !0 }, kE = /^(https?|ircs?|mailto|xmpp)$/i, zE = [
  { from: "astPlugins", id: "remove-buggy-html-in-markdown-parser" },
  { from: "allowDangerousHtml", id: "remove-buggy-html-in-markdown-parser" },
  {
    from: "allowNode",
    id: "replace-allownode-allowedtypes-and-disallowedtypes",
    to: "allowElement"
  },
  {
    from: "allowedTypes",
    id: "replace-allownode-allowedtypes-and-disallowedtypes",
    to: "allowedElements"
  },
  { from: "className", id: "remove-classname" },
  {
    from: "disallowedTypes",
    id: "replace-allownode-allowedtypes-and-disallowedtypes",
    to: "disallowedElements"
  },
  { from: "escapeHtml", id: "remove-buggy-html-in-markdown-parser" },
  { from: "includeElementIndex", id: "#remove-includeelementindex" },
  {
    from: "includeNodeIndex",
    id: "change-includenodeindex-to-includeelementindex"
  },
  { from: "linkTarget", id: "remove-linktarget" },
  { from: "plugins", id: "change-plugins-to-remarkplugins", to: "remarkPlugins" },
  { from: "rawSourcePos", id: "#remove-rawsourcepos" },
  { from: "renderers", id: "change-renderers-to-components", to: "components" },
  { from: "source", id: "change-source-to-children", to: "children" },
  { from: "sourcePos", id: "#remove-sourcepos" },
  { from: "transformImageUri", id: "#add-urltransform", to: "urlTransform" },
  { from: "transformLinkUri", id: "#add-urltransform", to: "urlTransform" }
];
function wE(n) {
  const a = DE(n), u = OE(n);
  return NE(a.runSync(a.parse(u), u), n);
}
function DE(n) {
  const a = n.rehypePlugins || Am, u = n.remarkPlugins || Am, r = n.remarkRehypeOptions ? { ...n.remarkRehypeOptions, ...Cm } : Cm;
  return xE().use(cS).use(u).use(iE, r).use(a);
}
function OE(n) {
  const a = n.children || "", u = new vg();
  return typeof a == "string" && (u.value = a), u;
}
function NE(n, a) {
  const u = a.allowedElements, r = a.allowElement, c = a.components, h = a.disallowedElements, f = a.skipHtml, d = a.unwrapDisallowed, m = a.urlTransform || RE;
  for (const y of zE)
    Object.hasOwn(a, y.from) && ("" + y.from + (y.to ? "use `" + y.to + "` instead" : "remove it") + _E + y.id, void 0);
  return dr(n, p), J0(n, {
    Fragment: Mt.Fragment,
    components: c,
    ignoreInvalidStyle: !0,
    jsx: Mt.jsx,
    jsxs: Mt.jsxs,
    passKeys: !0,
    passNode: !0
  });
  function p(y, b, E) {
    if (y.type === "raw" && E && typeof b == "number")
      return f ? E.children.splice(b, 1) : E.children[b] = { type: "text", value: y.value }, b;
    if (y.type === "element") {
      let v;
      for (v in jc)
        if (Object.hasOwn(jc, v) && Object.hasOwn(y.properties, v)) {
          const A = y.properties[v], w = jc[v];
          (w === null || w.includes(y.tagName)) && (y.properties[v] = m(String(A || ""), v, y));
        }
    }
    if (y.type === "element") {
      let v = u ? !u.includes(y.tagName) : h ? h.includes(y.tagName) : !1;
      if (!v && r && typeof b == "number" && (v = !r(y, b, E)), v && E && typeof b == "number")
        return d && y.children ? E.children.splice(b, 1, ...y.children) : E.children.splice(b, 1), b;
    }
  }
}
function RE(n) {
  const a = n.indexOf(":"), u = n.indexOf("?"), r = n.indexOf("#"), c = n.indexOf("/");
  return (
    // If there is no protocol, it’s relative.
    a === -1 || // If the first colon is after a `?`, `#`, or `/`, it’s not a protocol.
    c !== -1 && a > c || u !== -1 && a > u || r !== -1 && a > r || // It is a protocol, it should be allowed.
    kE.test(n.slice(0, a)) ? n : ""
  );
}
function _m(n, a) {
  const u = String(n);
  if (typeof a != "string")
    throw new TypeError("Expected character");
  let r = 0, c = u.indexOf(a);
  for (; c !== -1; )
    r++, c = u.indexOf(a, c + a.length);
  return r;
}
function ME(n) {
  if (typeof n != "string")
    throw new TypeError("Expected a string");
  return n.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");
}
function UE(n, a, u) {
  const c = fr((u || {}).ignore || []), h = LE(a);
  let f = -1;
  for (; ++f < h.length; )
    cs(n, d);
  function d(p, y, b) {
    if (p.type === "text" && typeof b == "number")
      return m(p, y, b);
    if (c(p, b, y[y.length - 1])) return os;
  }
  function m(p, y, b) {
    const E = y[y.length - 1], v = h[f][0], A = h[f][1];
    let w = 0, q = !1, z = [];
    v.lastIndex = 0;
    let X = v.exec(p.value);
    for (; X; ) {
      const W = X.index, it = {
        index: X.index,
        input: X.input,
        stack: [...y, p]
      };
      let H = A(...X, it);
      if (typeof H == "string" && (H = H.length > 0 ? { type: "text", value: H } : void 0), H === !1)
        v.lastIndex = W + 1;
      else {
        if (w !== W && U({ type: "text", value: p.value.slice(w, W) }), Array.isArray(H))
          for (const J of H) U(J);
        else H && U(H);
        w = W + X[0].length, q = !0;
      }
      if (!v.global)
        break;
      X = v.exec(p.value);
    }
    return q ? (w < p.value.length && U({ type: "text", value: p.value.slice(w) }), E.children.splice(b, 1, ...z)) : z = [p], b + z.length;
    function U(W) {
      const it = z[z.length - 1];
      it && it.type === "text" && W.type === "text" ? it.value += W.value : z.push(W);
    }
  }
}
function LE(n) {
  if (!Array.isArray(n))
    throw new TypeError("Expected find and replace tuple or list of tuples");
  const a = [], u = !n[0] || Array.isArray(n[0]) ? (
    /** @type {FindAndReplaceList} */
    n
  ) : [
    /** @type {FindAndReplaceTuple} */
    n
  ];
  let r = -1;
  for (; ++r < u.length; ) {
    const c = u[r];
    a.push([BE(c[0]), HE(c[1])]);
  }
  return a;
}
function BE(n) {
  return typeof n == "string" ? new RegExp(ME(n), "g") : n;
}
function HE(n) {
  return typeof n == "function" ? n : function() {
    return n;
  };
}
const Fc = "phrasing", $c = ["autolink", "link", "image", "label"];
function jE() {
  return {
    transforms: [XE],
    enter: {
      literalAutolink: IE,
      literalAutolinkEmail: Wc,
      literalAutolinkHttp: Wc,
      literalAutolinkWww: Wc
    },
    exit: {
      literalAutolink: QE,
      literalAutolinkEmail: GE,
      literalAutolinkHttp: VE,
      literalAutolinkWww: YE
    }
  };
}
function qE() {
  return {
    unsafe: [
      {
        character: "@",
        before: "[+\\-.\\w]",
        after: "[\\-.\\w]",
        inConstruct: Fc,
        notInConstruct: $c
      },
      {
        character: ".",
        before: "[Ww]",
        after: "[\\-.\\w]",
        inConstruct: Fc,
        notInConstruct: $c
      },
      {
        character: ":",
        before: "[ps]",
        after: "\\/",
        inConstruct: Fc,
        notInConstruct: $c
      }
    ]
  };
}
function IE(n) {
  this.enter(
    { type: "link", title: null, url: "", children: [], position: void 0 },
    n
  );
}
function Wc(n) {
  this.config.enter.autolinkProtocol.call(this, n);
}
function VE(n) {
  this.config.exit.autolinkProtocol.call(this, n);
}
function YE(n) {
  this.config.exit.data.call(this, n);
  const a = this.stack[this.stack.length - 1];
  a.type, a.url = "http://" + this.sliceSerialize(n);
}
function GE(n) {
  this.config.exit.autolinkEmail.call(this, n);
}
function QE(n) {
  this.exit(n);
}
function XE(n) {
  UE(
    n,
    [
      [
        /(?<![\da-z])(https?:\/\/|www(?=\.))([\w-]*\.[\w\-.]*)([^\t\n\r ]*)/gi,
        ZE
      ],
      [
        /(?<![\w+\-.@])xmpp:([\w+\-.]+)@([\w-]+(?:\.[\w-]+)+)(\/(?:[\w\-/]|\.(?=[\dA-Za-z]))*)?/g,
        FE
      ],
      [/(?<![\w+\-.@])mailto:([\w+\-.]+)@([\w-]+(?:\.[\w-]+)+)/g, JE],
      [
        /(?<![\w+\-.]|(?:^|[^\d@A-Za-z])(?:mailto|xmpp):)([\w+\-.]+)@([\w-]+(?:\.[\w-]+)+)/g,
        KE
      ]
    ],
    { ignore: ["link", "linkReference"] }
  );
}
function ZE(n, a, u, r, c) {
  if (!PE(c))
    return !1;
  let h = "";
  if (/^w/i.test(a) && (u = a + u, a = "", h = "http://"), Na(u.charCodeAt(0)) || !$E(u))
    return !1;
  const f = WE(u + r), d = {
    type: "link",
    title: null,
    url: h + a + f[0],
    children: [{ type: "text", value: a + f[0], position: void 0 }],
    position: void 0
  };
  return f[1] ? [d, { type: "text", value: f[1], position: void 0 }] : d;
}
function KE(n, a, u) {
  return /[\d\-_]$/.test(u) ? !1 : {
    type: "link",
    title: null,
    url: "mailto:" + a + "@" + u,
    children: [{ type: "text", value: a + "@" + u, position: void 0 }],
    position: void 0
  };
}
function JE(n, a, u) {
  if (/[\d\-_]$/.test(u))
    return !1;
  const r = "mailto:" + a + "@" + u;
  return {
    type: "link",
    title: null,
    url: r,
    children: [{ type: "text", value: r, position: void 0 }],
    position: void 0
  };
}
function FE(n, a, u, r, c) {
  if (/[\d\-_]$/.test(u) || r && (!/[A-Za-z]$/.test(r) || c.input.charAt(c.index + n.length) === "@"))
    return !1;
  const h = "xmpp:" + a + "@" + u + (r || "");
  return {
    type: "link",
    title: null,
    url: h,
    children: [{ type: "text", value: h, position: void 0 }],
    position: void 0
  };
}
function $E(n) {
  const a = n.split(".");
  return !(a.length < 2 || a[a.length - 1] && (/_/.test(a[a.length - 1]) || !/[\dA-Za-z]/.test(a[a.length - 1])) || a[a.length - 2] && (/_/.test(a[a.length - 2]) || !/[\dA-Za-z]/.test(a[a.length - 2])));
}
function WE(n) {
  let a = n.length;
  for (; a > 0; ) {
    const f = n.charCodeAt(a - 1);
    if (f === 33 || f === 34 || f === 38 || f === 39 || f === 41 || f === 44 || f === 46 || f === 58 || f === 59 || f === 60 || f === 62 || f === 63 || f === 93 || f === 125)
      a--;
    else
      break;
  }
  if (a === n.length)
    return [n, void 0];
  let u = n.slice(a);
  n = n.slice(0, a);
  let r = u.indexOf(")");
  const c = _m(n, "(");
  let h = _m(n, ")");
  for (; r !== -1 && c > h; )
    n += u.slice(0, r + 1), u = u.slice(r + 1), r = u.indexOf(")"), h++;
  return [n, u];
}
function PE(n) {
  const a = n.input.charCodeAt(n.index - 1);
  return n.index === 0 || Nl(a) || Na(a);
}
Sg.peek = ox;
function tx() {
  this.buffer();
}
function ex(n) {
  this.enter({ type: "footnoteReference", identifier: "", label: "" }, n);
}
function nx() {
  this.buffer();
}
function lx(n) {
  this.enter(
    { type: "footnoteDefinition", identifier: "", label: "", children: [] },
    n
  );
}
function ix(n) {
  const a = this.resume(), u = this.stack[this.stack.length - 1];
  u.type, u.identifier = an(
    this.sliceSerialize(n)
  ).toLowerCase(), u.label = a;
}
function ax(n) {
  this.exit(n);
}
function ux(n) {
  const a = this.resume(), u = this.stack[this.stack.length - 1];
  u.type, u.identifier = an(
    this.sliceSerialize(n)
  ).toLowerCase(), u.label = a;
}
function rx(n) {
  this.exit(n);
}
function ox() {
  return "[";
}
function Sg(n, a, u, r) {
  const c = u.createTracker(r);
  let h = c.move("[^");
  const f = u.enter("footnoteReference"), d = u.enter("reference");
  return h += c.move(
    u.safe(u.associationId(n), { after: "]", before: h })
  ), d(), f(), h += c.move("]"), h;
}
function cx() {
  return {
    enter: {
      gfmFootnoteCallString: tx,
      gfmFootnoteCall: ex,
      gfmFootnoteDefinitionLabelString: nx,
      gfmFootnoteDefinition: lx
    },
    exit: {
      gfmFootnoteCallString: ix,
      gfmFootnoteCall: ax,
      gfmFootnoteDefinitionLabelString: ux,
      gfmFootnoteDefinition: rx
    }
  };
}
function sx(n) {
  let a = !1;
  return n && n.firstLineBlank && (a = !0), {
    handlers: { footnoteDefinition: u, footnoteReference: Sg },
    // This is on by default already.
    unsafe: [{ character: "[", inConstruct: ["label", "phrasing", "reference"] }]
  };
  function u(r, c, h, f) {
    const d = h.createTracker(f);
    let m = d.move("[^");
    const p = h.enter("footnoteDefinition"), y = h.enter("label");
    return m += d.move(
      h.safe(h.associationId(r), { before: m, after: "]" })
    ), y(), m += d.move("]:"), r.children && r.children.length > 0 && (d.shift(4), m += d.move(
      (a ? `
` : " ") + h.indentLines(
        h.containerFlow(r, d.current()),
        a ? Eg : fx
      )
    )), p(), m;
  }
}
function fx(n, a, u) {
  return a === 0 ? n : Eg(n, a, u);
}
function Eg(n, a, u) {
  return (u ? "" : "    ") + n;
}
const hx = [
  "autolink",
  "destinationLiteral",
  "destinationRaw",
  "reference",
  "titleQuote",
  "titleApostrophe"
];
Os.attention = yx;
Os.peek = bx;
function dx() {
  return {
    canContainEols: ["delete"],
    enter: { strikethrough: mx },
    exit: { strikethrough: gx }
  };
}
function px() {
  return {
    handlers: { delete: Os },
    unsafe: [
      {
        character: "~",
        inConstruct: "phrasing",
        notInConstruct: hx
      }
    ]
  };
}
function mx(n) {
  this.enter({ type: "delete", children: [], position: void 0 }, n);
}
function gx(n) {
  this.exit(n);
}
function Os(n, a, u, r) {
  const c = u.createTracker(r), h = u.stack.includes("strikethrough") ? "~" : "~~", f = u.enter("strikethrough");
  let d = c.move(h);
  return d += u.containerPhrasing(n, {
    ...c.current(),
    before: d,
    after: "~"
  }), d += c.move(h), f(), d;
}
function yx() {
  return { construct: "strikethrough", markers: ["~"], sizes: [2, 1] };
}
function bx() {
  return "~";
}
function vx(n) {
  return n.length;
}
function Sx(n, a) {
  const u = a || {}, r = (u.align || []).concat(), c = u.stringLength || vx, h = [], f = [], d = [], m = [];
  let p = 0, y = -1;
  for (; ++y < n.length; ) {
    const w = [], q = [];
    let z = -1;
    for (n[y].length > p && (p = n[y].length); ++z < n[y].length; ) {
      const X = Ex(n[y][z]);
      if (u.alignDelimiters !== !1) {
        const U = c(X);
        q[z] = U, (m[z] === void 0 || U > m[z]) && (m[z] = U);
      }
      w.push(X);
    }
    f[y] = w, d[y] = q;
  }
  let b = -1;
  if (typeof r == "object" && "length" in r)
    for (; ++b < p; )
      h[b] = km(r[b]);
  else {
    const w = km(r);
    for (; ++b < p; )
      h[b] = w;
  }
  b = -1;
  const E = [], v = [];
  for (; ++b < p; ) {
    const w = h[b];
    let q = "", z = "";
    w === 99 ? (q = ":", z = ":") : w === 108 ? q = ":" : w === 114 && (z = ":");
    let X = u.alignDelimiters === !1 ? 1 : Math.max(
      1,
      m[b] - q.length - z.length
    );
    const U = q + "-".repeat(X) + z;
    u.alignDelimiters !== !1 && (X = q.length + X + z.length, X > m[b] && (m[b] = X), v[b] = X), E[b] = U;
  }
  f.splice(1, 0, E), d.splice(1, 0, v), y = -1;
  const A = [];
  for (; ++y < f.length; ) {
    const w = f[y], q = d[y], z = u.fillRows === !1 ? Math.max(1, f[y === 1 ? 0 : y].length) : p;
    b = -1;
    const X = [];
    for (; ++b < z; ) {
      const U = w[b] || "";
      let W = "", it = "";
      if (u.alignDelimiters !== !1) {
        const H = m[b] - (q[b] || 0), J = h[b];
        if (J === 114)
          W = " ".repeat(H);
        else if (J === 99) {
          const ct = H / 2;
          H % 2 ? (W = " ".repeat(ct + 0.5), it = " ".repeat(ct - 0.5)) : (W = " ".repeat(ct), it = W);
        } else
          it = " ".repeat(H);
      }
      u.delimiterStart !== !1 && !b && X.push("|"), u.padding !== !1 && // Don’t add the opening space if we’re not aligning and the cell is
      // empty: there will be a closing space.
      !(u.alignDelimiters === !1 && U === "") && (u.delimiterStart !== !1 || b) && X.push(" "), u.alignDelimiters !== !1 && X.push(W), X.push(U), u.alignDelimiters !== !1 && X.push(it), u.padding !== !1 && X.push(" "), (u.delimiterEnd !== !1 || b !== z - 1) && X.push("|");
    }
    A.push(
      u.delimiterEnd === !1 ? X.join("").replace(/ +$/, "") : X.join("")
    );
  }
  return A.join(`
`);
}
function Ex(n) {
  return n == null ? "" : String(n);
}
function km(n) {
  const a = typeof n == "string" ? n.codePointAt(0) : 0;
  return a === 67 || a === 99 ? 99 : a === 76 || a === 108 ? 108 : a === 82 || a === 114 ? 114 : 0;
}
const xx = (
  /** @type {(node?: unknown) => node is Exclude<PhrasingContent, Html>} */
  fr([
    "break",
    "delete",
    "emphasis",
    // To do: next major: removed since footnotes were added to GFM.
    "footnote",
    "footnoteReference",
    "image",
    "imageReference",
    "inlineCode",
    // Enabled by `mdast-util-math`:
    "inlineMath",
    "link",
    "linkReference",
    // Enabled by `mdast-util-mdx`:
    "mdxJsxTextElement",
    // Enabled by `mdast-util-mdx`:
    "mdxTextExpression",
    "strong",
    "text",
    // Enabled by `mdast-util-directive`:
    "textDirective"
  ])
);
function Tx(n, a, u, r) {
  const c = u.enter("blockquote"), h = u.createTracker(r);
  h.move("> "), h.shift(2);
  const f = u.indentLines(
    u.containerFlow(n, h.current()),
    Ax
  );
  return c(), f;
}
function Ax(n, a, u) {
  return ">" + (u ? "" : " ") + n;
}
function Cx(n, a) {
  return zm(n, a.inConstruct, !0) && !zm(n, a.notInConstruct, !1);
}
function zm(n, a, u) {
  if (typeof a == "string" && (a = [a]), !a || a.length === 0)
    return u;
  let r = -1;
  for (; ++r < a.length; )
    if (n.includes(a[r]))
      return !0;
  return !1;
}
function wm(n, a, u, r) {
  let c = -1;
  for (; ++c < u.unsafe.length; ) {
    const h = u.unsafe[c];
    if (h.character === `
` && !h.before && !h.after && Cx(u.stack, h))
      return /[\t ]/.test(r.before) ? "" : " ";
  }
  return `\\
`;
}
function _x(n, a) {
  const u = String(n);
  let r = u.indexOf(a), c = r, h = 0, f = 0;
  if (typeof a != "string")
    throw new TypeError("Expected substring");
  for (; r !== -1; )
    r === c ? ++h > f && (f = h) : h = 1, c = r + a.length, r = u.indexOf(a, c);
  return f;
}
function kx(n, a) {
  return !!(a.options.fences === !1 && n.value && // If there’s no info…
  !n.lang && // And there’s a non-whitespace character…
  /[^\n\r ]/.test(n.value) && // And the value doesn’t start or end in a blank…
  !/^[\t ]*(?:[\n\r]|$)|(?:^|[\n\r])[\t ]*$/.test(n.value));
}
function zx(n) {
  const a = n.options.fence || "`";
  if (a !== "`" && a !== "~")
    throw new Error(
      "Cannot serialize code with `" + a + "` for `options.fence`, expected `` ` `` or `~`"
    );
  return a;
}
function wx(n, a, u, r) {
  const c = zx(u), h = n.value || "";
  if (kx(n, u)) {
    const b = u.enter("codeIndented"), E = u.indentLines(h, Dx);
    return b(), E;
  }
  const f = u.createTracker(r), d = c.repeat(Math.max(_x(h, c) + 1, 3)), m = u.enter("codeFenced"), p = c === "`" ? "GraveAccent" : "Tilde";
  let y = f.move(d);
  if (n.lang) {
    const b = u.enter(`codeFencedLang${p}`);
    y += f.move(
      u.safe(n.lang, {
        before: y,
        after: " ",
        encode: ["`"],
        ...f.current()
      })
    ), b();
  }
  if (n.lang && n.meta) {
    const b = u.enter(`codeFencedMeta${p}`);
    y += f.move(" "), y += f.move(
      u.safe(n.meta, {
        before: y,
        after: `
`,
        encode: ["`"],
        ...f.current()
      })
    ), b();
  }
  return y += f.move(`
`), h && (y += f.move(h + `
`)), y += f.move(d), m(), y;
}
function Dx(n, a, u) {
  return (u ? "" : "    ") + n;
}
function Ns(n) {
  const a = n.options.quote || '"';
  if (a !== '"' && a !== "'")
    throw new Error(
      "Cannot serialize title with `" + a + "` for `options.quote`, expected `\"`, or `'`"
    );
  return a;
}
function Ox(n, a, u, r) {
  const c = Ns(u), h = c === '"' ? "Quote" : "Apostrophe", f = u.enter("definition");
  let d = u.enter("label");
  const m = u.createTracker(r);
  let p = m.move("[");
  return p += m.move(
    u.safe(u.associationId(n), {
      before: p,
      after: "]",
      ...m.current()
    })
  ), p += m.move("]: "), d(), // If there’s no url, or…
  !n.url || // If there are control characters or whitespace.
  /[\0- \u007F]/.test(n.url) ? (d = u.enter("destinationLiteral"), p += m.move("<"), p += m.move(
    u.safe(n.url, { before: p, after: ">", ...m.current() })
  ), p += m.move(">")) : (d = u.enter("destinationRaw"), p += m.move(
    u.safe(n.url, {
      before: p,
      after: n.title ? " " : `
`,
      ...m.current()
    })
  )), d(), n.title && (d = u.enter(`title${h}`), p += m.move(" " + c), p += m.move(
    u.safe(n.title, {
      before: p,
      after: c,
      ...m.current()
    })
  ), p += m.move(c), d()), f(), p;
}
function Nx(n) {
  const a = n.options.emphasis || "*";
  if (a !== "*" && a !== "_")
    throw new Error(
      "Cannot serialize emphasis with `" + a + "` for `options.emphasis`, expected `*`, or `_`"
    );
  return a;
}
function ur(n) {
  const a = n.codePointAt(0);
  return a === void 0 ? "" : String.fromCodePoint(a);
}
function xi(n) {
  const a = n.codePointAt(n.length - 2);
  return a !== void 0 && a > 65535 ? n.slice(-2) : n.slice(-1);
}
function xg(n) {
  return "&#x" + n.toString(16).toUpperCase() + ";";
}
function Dm(n, a, u) {
  const r = rl(n), c = rl(a);
  return r === void 0 ? c === void 0 ? (
    // Letter inside:
    // we have to encode *both* letters for `_` as it is looser.
    // it already forms for `*` (and GFMs `~`).
    u === "_" ? { inside: !0, outside: !0 } : { inside: !1, outside: !1 }
  ) : c === 1 ? (
    // Whitespace inside: encode both (letter, whitespace).
    { inside: !0, outside: !0 }
  ) : (
    // Punctuation inside: encode outer (letter)
    { inside: !1, outside: !0 }
  ) : r === 1 ? c === void 0 ? (
    // Letter inside: already forms.
    { inside: !1, outside: !1 }
  ) : c === 1 ? (
    // Whitespace inside: encode both (whitespace).
    { inside: !0, outside: !0 }
  ) : (
    // Punctuation inside: already forms.
    { inside: !1, outside: !1 }
  ) : c === void 0 ? (
    // Letter inside: already forms.
    { inside: !1, outside: !1 }
  ) : c === 1 ? (
    // Whitespace inside: encode inner (whitespace).
    { inside: !0, outside: !1 }
  ) : (
    // Punctuation inside: already forms.
    { inside: !1, outside: !1 }
  );
}
function Rx(n) {
  if (n.charCodeAt(0) !== 60) return;
  const a = n.charCodeAt(1);
  if (a === 33) {
    const d = n.charCodeAt(2);
    return d === 45 ? 2 : d === 91 ? 5 : ge(d) ? 4 : void 0;
  }
  if (a === 63) return 3;
  const u = a === 47, r = u ? 2 : 1;
  let c = r, h = n.charCodeAt(c);
  if (!ge(h)) return;
  for (; h === 45 || ye(h); )
    h = n.charCodeAt(++c);
  const f = n.slice(r, c).toLowerCase();
  return !u && h !== 47 && rs.includes(f) ? 1 : rg.includes(f) ? 6 : 7;
}
const Tg = /* @__PURE__ */ new Map([
  ["*", !1],
  ["_", !0]
]);
function Mx(n, a, u) {
  const r = /* @__PURE__ */ new Set();
  for (const h of n) {
    const f = u.get(h);
    if (f && h.attention && a.some((d) => d.attention === h.attention))
      for (const d of f.tokens)
        r.add(d.attention);
  }
  const c = [];
  for (const h of n)
    h.attention && r.delete(h.attention) && c.push(h.attention);
  return c.reverse(), c;
}
function Ag(n, a, u) {
  const r = [], c = /* @__PURE__ */ new Map(), h = /* @__PURE__ */ new Map();
  let f = 0;
  for (; f < n.length; ) {
    if (!n[f].attention) {
      f++;
      continue;
    }
    const d = n[f].value.charAt(0), m = Tg.get(d);
    let p = f + 1;
    for (; p < n.length && n[p].attention && n[p].value.charAt(0) === d; )
      p++;
    const y = f ? n[f - 1].value : a, b = rl(y.charCodeAt(y.length - 1)), E = rl(
      (p < n.length ? n[p].value : u).charCodeAt(0)
    ), v = !E || E === 2 && !!b, A = !b || b === 2 && !!E, w = {
      tokens: n.slice(f, p),
      markers: [],
      start: 0,
      end: 0,
      // Underscores are strict, they cannot open or close inside words.
      open: m ? v && (!!b || !A) : v,
      close: m ? A && (!!E || !v) : A,
      // All builtins can split runs.
      split: m !== void 0
    };
    for (const q of w.tokens) {
      c.set(q, [...w.tokens]), h.set(q, w);
      let z = q.value.length;
      for (; z--; ) w.markers.push(q);
    }
    w.end = w.markers.length, r.push(w), f = p;
  }
  for (Lx(r, c), f = -1; ++f < n.length; ) {
    const d = c.get(n[f]);
    if (d) return { attention: Mx(n, d, h), index: f };
  }
}
function Pu(n, a) {
  const u = n[a ? 0 : n.length - 1];
  if (!u || u.attention) return;
  const r = a ? ur(u.value) : xi(u.value), c = xg(
    /** @type {number} */
    r.codePointAt(0)
  );
  if (a)
    u.value = c + u.value.slice(r.length);
  else {
    let h = u.value.slice(0, u.value.length - r.length), f = 0;
    for (; h.charCodeAt(h.length - 1 - f) === 92; )
      f++;
    f % 2 && (h += "\\"), u.value = h + c;
  }
}
function Ux(n, a, u, r, c) {
  for (const h of u.attention) {
    const f = a.get(h) || h.sequences[0];
    for (const d of h.sequences) {
      if (d === f) continue;
      const m = new Map(a);
      m.set(h, d);
      const p = pr(n, m, r, c), y = Ag(p, r, c);
      if (!y || y.index > u.index)
        return { chosen: m, mistake: y, tokens: p };
    }
  }
}
function Lx(n, a) {
  const u = /* @__PURE__ */ new Map();
  for (const r of n) {
    const c = r.tokens[0].value.charAt(0);
    let h = u.get(c);
    h || (h = [], u.set(c, h));
    let f = r.close ? h.length : 0;
    for (; f-- && r.start < r.end; ) {
      const d = h[f], m = d.end - d.start, p = r.end - r.start;
      if (r.split ? (
        // The rule of 3, on the sizes that are left.
        (d.close || r.open) && p % 3 && !((m + p) % 3)
      ) : (
        // Others pair whole runs of the same size.
        m !== d.markers.length || m !== p
      ))
        continue;
      const y = r.split ? m > 1 && p > 1 ? 2 : 1 : p, b = d.markers.slice(d.end - y, d.end), E = r.markers.slice(r.start, r.start + y), v = b[0], A = E[0];
      if (
        // Whole sequences:
        // the markers of a sequence are next to each other,
        // so if the first and last marker are of one sequence of that size,
        // all markers are exactly that sequence.
        v === b[y - 1] && v.value.length === y && A === E[y - 1] && A.value.length === y && // Of the same attention, so its opening and closing sequence.
        v.attention === A.attention
      )
        a.delete(v), a.delete(A);
      else {
        const w = [.../* @__PURE__ */ new Set([...b, ...E])];
        for (const q of w) {
          const z = a.get(q);
          z && z.push(...w);
        }
      }
      d.end -= y, r.start += y, d.start === d.end && h.splice(f, 1), f = h.length;
    }
    r.open && r.start < r.end && h.push(r);
  }
}
function Bx(n, a, u) {
  if (a.length === 0)
    throw new Error(
      "Cannot serialize `" + n + "` as attention without markers, expected one or more markers"
    );
  if (u.length === 0)
    throw new Error(
      "Cannot serialize `" + n + "` as attention without sizes, expected one or more sizes"
    );
  for (const c of u)
    if (!Number.isSafeInteger(c) || c < 1)
      throw new Error(
        "Cannot serialize `" + n + "` as attention with `" + c + "` as size, expected positive integer"
      );
  const r = [];
  for (const c of a) {
    if (c.length !== 1)
      throw new Error(
        "Cannot serialize `" + n + "` as attention with `" + c + "` as marker, expected a single ascii character"
      );
    if (!Wm(c.charCodeAt(0)))
      throw new Error(
        "Cannot serialize `" + n + "` as attention with `" + c + "` as marker, expected ascii punctuation"
      );
    for (const h of u)
      r.push(c.repeat(h));
  }
  return r;
}
function Hx(n, a, u) {
  const r = a.indexStack, c = n.children || [], h = [];
  let f = -1, d = u.before;
  r.push(-1);
  let m = a.createTracker(u);
  for (; ++f < c.length; ) {
    const p = c[f];
    let y;
    if (r[r.length - 1] = f, f + 1 < c.length) {
      let v = a.handle.handlers[c[f + 1].type];
      v && v.peek && (v = v.peek), y = v ? ur(
        v(c[f + 1], n, a, {
          before: "",
          after: "",
          ...m.current()
        })
      ) : "";
    } else
      y = u.after;
    const b = h[h.length - 1];
    typeof b == "string" && (d === "\r" || d === `
`) && p.type === "html" && Rx(p.value) !== 7 && (h[h.length - 1] = b.replace(/(\r?\n|\r)$/, " "), d = " ", m = a.createTracker(u), m.move(mr(h, u.before, u.after)));
    const E = a.handle.handlers[p.type];
    if (E && E.attention) {
      const v = Rs(
        /** @type {PhrasingParents} */
        p,
        E.attention,
        a,
        m
      );
      if (!v) continue;
      h.push(v), d = xi(v.sequences[0]);
    } else {
      const v = a.handle(p, n, a, {
        ...m.current(),
        after: y,
        before: d
      });
      if (!v) continue;
      m.move(v), h.push(v), d = xi(v);
    }
  }
  return r.pop(), h;
}
function Rs(n, a, u, r) {
  const { construct: c, markers: h, sizes: f } = a(n, u), d = Bx(n.type, h, f), m = d[0], p = u.enter(c), y = u.createTracker(r.current());
  y.move(m);
  const b = Hx(n, u, {
    ...y.current(),
    before: m,
    after: m
  });
  if (p(), b.length !== 0)
    return r.move(m), r.move(mr(b, m, m)), r.move(m), { children: b, sequences: d };
}
function Om(n, a, u, r) {
  let c = pr(n, a, u, r), h = Ag(c, u, r);
  for (; h; ) {
    const f = Ux(n, a, h, u, r);
    if (!f) return;
    a = f.chosen, c = f.tokens, h = f.mistake;
  }
  return c;
}
function Cg(n, a, u, r) {
  let c = u, h = -1;
  for (; ++h < n.length; ) {
    const f = n[h];
    if (typeof f == "string") {
      c = "";
      continue;
    }
    const d = h === n.length - 1 ? r : "", m = f.sequences.find(function(p) {
      const y = p.charAt(0);
      return y !== c.charAt(0) && y !== d.charAt(0) || n.length === 1 && Tg.has(y) && p.length > u.length;
    }) || f.sequences[0];
    m !== f.sequences[0] && a.set(f, m), Cg(f.children, a, m, m), c = m;
  }
}
function pr(n, a, u, r) {
  const c = [];
  let h, f = xi(u), d = -1;
  for (; ++d < n.length; ) {
    const m = n[d];
    if (typeof m == "string") {
      const U = { value: m, attention: void 0 };
      h && h === ur(m) && Pu([U], !0), h = void 0, c.push(U), U.value && (f = xi(U.value));
      continue;
    }
    const p = a.get(m) || m.sequences[0], y = p.charAt(0), b = n[d + 1], E = f, v = ur(
      b === void 0 ? r : typeof b == "string" ? b : a.get(b) || b.sequences[0]
    ), A = pr(m.children, a, p, p), w = A[0].value, q = Dm(
      E.charCodeAt(E.length - 1),
      w.charCodeAt(0),
      y
    );
    q.inside && Pu(A, !0);
    const z = xi(A[A.length - 1].value), X = Dm(
      v.charCodeAt(0),
      z.charCodeAt(z.length - 1),
      y
    );
    X.inside && Pu(A, !1), q.outside && E !== `
` && E !== "\r" && Pu(c, !1), X.outside && (h = v), c.push({ value: p, attention: m }, ...A, {
      value: p,
      attention: m
    }), f = p.charAt(p.length - 1);
  }
  return c;
}
function mr(n, a, u) {
  const r = /* @__PURE__ */ new Map();
  Cg(n, r, a, u);
  const c = (
    // Start from guesses (based on the preferred sequences).
    (r.size > 0 ? Om(n, r, a, u) : void 0) || // If stuck, start from the preferred sequences instead.
    Om(n, /* @__PURE__ */ new Map(), a, u) || // If stuck again, use the preferred sequences as they are.
    pr(n, /* @__PURE__ */ new Map(), a, u)
  );
  let h = "";
  for (const f of c) h += f.value;
  return h;
}
Ms.attention = _g;
Ms.peek = jx;
function Ms(n, a, u, r) {
  const c = u.enter("phrasing"), h = Rs(n, _g, u, u.createTracker(r)), f = h ? mr([h], r.before, r.after) : "";
  return c(), f;
}
function _g(n, a) {
  return {
    construct: "emphasis",
    markers: Nx(a) === "*" ? ["*", "_"] : ["_", "*"],
    sizes: [1]
  };
}
function jx(n, a, u) {
  return u.options.emphasis || "*";
}
function qx(n, a) {
  let u = !1;
  return dr(n, function(r) {
    if ("value" in r && /\r?\n|\r/.test(r.value) || r.type === "break")
      return u = !0, wa;
  }), !!((!n.depth || n.depth < 3) && or(n) && (a.options.setext || u));
}
function Ix(n, a, u, r) {
  const c = Math.max(Math.min(6, n.depth || 1), 1), h = u.createTracker(r);
  if (qx(n, u)) {
    const b = u.enter("headingSetext"), E = u.enter("phrasing"), v = u.containerPhrasing(n, {
      ...h.current(),
      before: `
`,
      after: `
`
    });
    return E(), b(), v + `
` + (c === 1 ? "=" : "-").repeat(
      // The whole size…
      v.length - // Minus the position of the character after the last EOL (or
      // 0 if there is none)…
      (Math.max(v.lastIndexOf("\r"), v.lastIndexOf(`
`)) + 1)
    );
  }
  const f = "#".repeat(c), d = u.enter("headingAtx"), m = u.enter("phrasing");
  h.move(f + " ");
  let p = u.containerPhrasing(n, {
    before: "# ",
    after: `
`,
    ...h.current()
  });
  const y = p.charCodeAt(0);
  return (y === 9 || y === 32) && (p = xg(y) + p.slice(1)), p = p ? f + " " + p : f, u.options.closeAtx && (p += " " + f), m(), d(), p;
}
kg.peek = Vx;
function kg(n) {
  return n.value || "";
}
function Vx() {
  return "<";
}
zg.peek = Yx;
function zg(n, a, u, r) {
  const c = Ns(u), h = c === '"' ? "Quote" : "Apostrophe", f = u.enter("image");
  let d = u.enter("label");
  const m = u.createTracker(r);
  let p = m.move("![");
  return p += m.move(
    u.safe(n.alt, { before: p, after: "]", ...m.current() })
  ), p += m.move("]("), d(), // If there’s no url but there is a title…
  !n.url && n.title || // If there are control characters or whitespace.
  /[\0- \u007F]/.test(n.url) ? (d = u.enter("destinationLiteral"), p += m.move("<"), p += m.move(
    u.safe(n.url, { before: p, after: ">", ...m.current() })
  ), p += m.move(">")) : (d = u.enter("destinationRaw"), p += m.move(
    u.safe(n.url, {
      before: p,
      after: n.title ? " " : ")",
      ...m.current()
    })
  )), d(), n.title && (d = u.enter(`title${h}`), p += m.move(" " + c), p += m.move(
    u.safe(n.title, {
      before: p,
      after: c,
      ...m.current()
    })
  ), p += m.move(c), d()), p += m.move(")"), f(), p;
}
function Yx() {
  return "!";
}
wg.peek = Gx;
function wg(n, a, u, r) {
  const c = n.referenceType, h = u.enter("imageReference");
  let f = u.enter("label");
  const d = u.createTracker(r);
  let m = d.move("![");
  const p = u.safe(n.alt, {
    before: m,
    after: "]",
    ...d.current()
  });
  m += d.move(p + "]["), f();
  const y = u.stack;
  u.stack = y.filter(function(E) {
    return E !== "phrasing";
  }), f = u.enter("reference");
  const b = u.safe(u.associationId(n), {
    before: m,
    after: "]",
    ...d.current()
  });
  return f(), u.stack = y, h(), c === "full" || !p || p !== b ? m += d.move(b + "]") : c === "shortcut" ? m = m.slice(0, -1) : m += d.move("]"), m;
}
function Gx() {
  return "!";
}
Dg.peek = Qx;
function Dg(n, a, u) {
  let r = n.value || "", c = "`", h = -1;
  for (; new RegExp("(^|[^`])" + c + "([^`]|$)").test(r); )
    c += "`";
  for (/[^\n\r ]/.test(r) && (/^[\n\r ]/.test(r) && /[\n\r ]$/.test(r) || /^`|`$/.test(r)) && (r = " " + r + " "); ++h < u.unsafe.length; ) {
    const f = u.unsafe[h], d = u.compilePattern(f);
    if (!f.atBreak) continue;
    let m;
    for (; m = d.exec(r); ) {
      let p = m.index;
      r.charCodeAt(p) === 10 && r.charCodeAt(p - 1) === 13 && p--, r = r.slice(0, p) + " " + r.slice(m.index + 1);
    }
  }
  return c + r + c;
}
function Qx() {
  return "`";
}
function Og(n, a) {
  const u = or(n);
  return !!(!a.options.resourceLink && // If there’s a url…
  n.url && // And there’s no title…
  !n.title && // And the content of `node` is a single text node…
  n.children && n.children.length === 1 && n.children[0].type === "text" && // And if the url is the same as the content…
  (u === n.url || "mailto:" + u === n.url) && // And that starts w/ a protocol…
  /^[a-z][+\-.a-z]+:/i.test(n.url) && // And that doesn’t contain ASCII control codes (character escapes and
  // references don’t work), space, or angle brackets…
  !/[\0- <>\u007F]/.test(n.url));
}
Ng.peek = Xx;
function Ng(n, a, u, r) {
  const c = Ns(u), h = c === '"' ? "Quote" : "Apostrophe", f = u.createTracker(r);
  if (Og(n, u)) {
    const A = u.stack;
    u.stack = A.filter(function(z) {
      return z !== "phrasing";
    });
    const w = u.enter("autolink");
    let q = f.move("<");
    return q += f.move(
      u.containerPhrasing(n, {
        before: q,
        after: ">",
        ...f.current()
      })
    ), q += f.move(">"), w(), u.stack = A, q;
  }
  const d = u.enter("link");
  let m = u.enter("label"), p = f.move("[");
  const y = u.containerPhrasing(n, {
    before: p,
    after: "](",
    ...f.current()
  });
  p += f.move(y), m(), p += f.move("](");
  const b = /[\0- \u007F]/.test(n.url), E = r.before.charAt(r.before.length - 1);
  let v = n.title || void 0;
  if (!v && !b && (E === `
` || E === "\r")) {
    let A = 0;
    for (; A < y.length && y.charCodeAt(A) !== 93; )
      A += y.charCodeAt(A) === 92 ? 2 : 1;
    y.charCodeAt(A + 1) === 58 && (v = "");
  }
  return /* If there’s no url but there is a title… */ !n.url && typeof v == "string" || // If there are control characters or whitespace.
  b ? (m = u.enter("destinationLiteral"), p += f.move("<"), p += f.move(
    u.safe(n.url, { before: p, after: ">", ...f.current() })
  ), p += f.move(">")) : (m = u.enter("destinationRaw"), p += f.move(
    u.safe(n.url, {
      before: p,
      after: typeof v == "string" ? " " : ")",
      ...f.current()
    })
  )), m(), typeof v == "string" && (m = u.enter(`title${h}`), p += f.move(" " + c), p += f.move(
    u.safe(v, {
      before: p,
      after: c,
      ...f.current()
    })
  ), p += f.move(c), m()), p += f.move(")"), d(), p;
}
function Xx(n, a, u) {
  return Og(n, u) ? "<" : "[";
}
Rg.peek = Zx;
function Rg(n, a, u, r) {
  const c = n.referenceType, h = u.enter("linkReference");
  let f = u.enter("label");
  const d = u.createTracker(r);
  let m = d.move("[");
  const p = u.containerPhrasing(n, {
    before: m,
    after: "]",
    ...d.current()
  });
  m += d.move(p + "]["), f();
  const y = u.stack;
  u.stack = y.filter(function(E) {
    return E !== "phrasing";
  }), f = u.enter("reference");
  const b = u.safe(u.associationId(n), {
    before: m,
    after: "]",
    ...d.current()
  });
  return f(), u.stack = y, h(), c === "full" || !p || p !== b ? m += d.move(b + "]") : c === "shortcut" ? m = m.slice(0, -1) : m += d.move("]"), m;
}
function Zx() {
  return "[";
}
function Us(n) {
  const a = n.options.bullet || "*";
  if (a !== "*" && a !== "+" && a !== "-")
    throw new Error(
      "Cannot serialize items with `" + a + "` for `options.bullet`, expected `*`, `+`, or `-`"
    );
  return a;
}
function Kx(n) {
  const a = Us(n), u = n.options.bulletOther;
  if (!u)
    return a === "*" ? "-" : "*";
  if (u !== "*" && u !== "+" && u !== "-")
    throw new Error(
      "Cannot serialize items with `" + u + "` for `options.bulletOther`, expected `*`, `+`, or `-`"
    );
  if (u === a)
    throw new Error(
      "Expected `bullet` (`" + a + "`) and `bulletOther` (`" + u + "`) to be different"
    );
  return u;
}
function Jx(n) {
  const a = n.options.bulletOrdered || ".";
  if (a !== "." && a !== ")")
    throw new Error(
      "Cannot serialize items with `" + a + "` for `options.bulletOrdered`, expected `.` or `)`"
    );
  return a;
}
function Mg(n) {
  const a = n.options.rule || "*";
  if (a !== "*" && a !== "-" && a !== "_")
    throw new Error(
      "Cannot serialize rules with `" + a + "` for `options.rule`, expected `*`, `-`, or `_`"
    );
  return a;
}
function Fx(n, a, u, r) {
  const c = u.enter("list"), h = u.bulletCurrent;
  let f = n.ordered ? Jx(u) : Us(u);
  const d = n.ordered ? f === "." ? ")" : "." : Kx(u);
  let m = a && u.bulletLastUsed ? f === u.bulletLastUsed : !1;
  if (!n.ordered) {
    const y = n.children ? n.children[0] : void 0;
    if (
      // Bullet could be used as a thematic break marker:
      (f === "*" || f === "-") && // Empty first list item:
      y && (!y.children || !y.children[0]) && // Directly in two other list items:
      u.stack[u.stack.length - 1] === "list" && u.stack[u.stack.length - 2] === "listItem" && u.stack[u.stack.length - 3] === "list" && u.stack[u.stack.length - 4] === "listItem" && // That are each the first child.
      u.indexStack[u.indexStack.length - 1] === 0 && u.indexStack[u.indexStack.length - 2] === 0 && u.indexStack[u.indexStack.length - 3] === 0 && (m = !0), Mg(u) === f && y
    ) {
      let b = -1;
      for (; ++b < n.children.length; ) {
        const E = n.children[b];
        if (E && E.type === "listItem" && E.children && E.children[0] && E.children[0].type === "thematicBreak") {
          m = !0;
          break;
        }
      }
    }
  }
  m && (f = d), u.bulletCurrent = f;
  const p = u.containerFlow(n, r);
  return u.bulletLastUsed = f, u.bulletCurrent = h, c(), p;
}
function $x(n) {
  const a = n.options.listItemIndent || "one";
  if (a !== "tab" && a !== "one" && a !== "mixed")
    throw new Error(
      "Cannot serialize items with `" + a + "` for `options.listItemIndent`, expected `tab`, `one`, or `mixed`"
    );
  return a;
}
function Wx(n, a, u, r) {
  const c = $x(u);
  let h = u.bulletCurrent || Us(u);
  a && a.type === "list" && a.ordered && (h = (typeof a.start == "number" && a.start > -1 ? a.start : 1) + (u.options.incrementListMarker === !1 ? 0 : a.children.indexOf(n)) + h);
  let f = h.length + 1;
  (c === "tab" || c === "mixed" && (a && a.type === "list" && a.spread || n.spread)) && (f = Math.ceil(f / 4) * 4);
  const d = u.createTracker(r);
  d.move(h + " ".repeat(f - h.length)), d.shift(f);
  const m = u.enter("listItem"), p = u.indentLines(
    u.containerFlow(n, d.current()),
    y
  );
  return m(), p;
  function y(b, E, v) {
    return E ? (v ? "" : " ".repeat(f)) + b : (v ? h : h + " ".repeat(f - h.length)) + b;
  }
}
function Px(n, a, u, r) {
  const c = u.enter("paragraph"), h = u.enter("phrasing"), f = u.containerPhrasing(n, r);
  return h(), c(), f;
}
function tT(n, a, u, r) {
  if (!n.children.some(function(d) {
    return xx(d);
  })) return u.containerFlow(n, r);
  const h = u.enter("phrasing"), f = u.containerPhrasing(n, r);
  return h(), f;
}
function eT(n) {
  const a = n.options.strong || "*";
  if (a !== "*" && a !== "_")
    throw new Error(
      "Cannot serialize strong with `" + a + "` for `options.strong`, expected `*`, or `_`"
    );
  return a;
}
Ls.attention = Ug;
Ls.peek = nT;
function Ls(n, a, u, r) {
  const c = u.enter("phrasing"), h = Rs(n, Ug, u, u.createTracker(r)), f = h ? mr([h], r.before, r.after) : "";
  return c(), f;
}
function Ug(n, a) {
  return {
    construct: "strong",
    markers: eT(a) === "*" ? ["*", "_"] : ["_", "*"],
    sizes: [2]
  };
}
function nT(n, a, u) {
  return u.options.strong || "*";
}
function lT(n, a, u, r) {
  const c = a ? a.children : [], h = u.indexStack[u.indexStack.length - 1];
  return u.safe(n.value, {
    ...r,
    afterNode: c[h + 1],
    beforeNode: c[h - 1]
  });
}
function iT(n) {
  const a = n.options.ruleRepetition || 3;
  if (a < 3)
    throw new Error(
      "Cannot serialize rules with repetition `" + a + "` for `options.ruleRepetition`, expected `3` or more"
    );
  return a;
}
function aT(n, a, u) {
  const r = (Mg(u) + (u.options.ruleSpaces ? " " : "")).repeat(iT(u));
  return u.options.ruleSpaces ? r.slice(0, -1) : r;
}
const ps = {
  blockquote: Tx,
  break: wm,
  code: wx,
  definition: Ox,
  emphasis: Ms,
  hardBreak: wm,
  heading: Ix,
  html: kg,
  image: zg,
  imageReference: wg,
  inlineCode: Dg,
  link: Ng,
  linkReference: Rg,
  list: Fx,
  listItem: Wx,
  paragraph: Px,
  root: tT,
  strong: Ls,
  text: lT,
  thematicBreak: aT
};
function uT() {
  return {
    enter: {
      table: rT,
      tableData: Nm,
      tableHeader: Nm,
      tableRow: cT
    },
    exit: {
      codeText: sT,
      table: oT,
      tableData: Pc,
      tableHeader: Pc,
      tableRow: Pc
    }
  };
}
function rT(n) {
  const a = n._align;
  this.enter(
    {
      type: "table",
      align: a.map(function(u) {
        return u === "none" ? null : u;
      }),
      children: [],
      position: void 0
    },
    n
  ), this.data.inTable = !0;
}
function oT(n) {
  this.exit(n), this.data.inTable = void 0;
}
function cT(n) {
  this.enter({ type: "tableRow", children: [], position: void 0 }, n);
}
function Pc(n) {
  this.exit(n);
}
function Nm(n) {
  this.enter({ type: "tableCell", children: [], position: void 0 }, n);
}
function sT(n) {
  let a = this.resume();
  this.data.inTable && (a = a.replace(/\\([\\|])/g, fT));
  const u = this.stack[this.stack.length - 1];
  u.type, u.value = a, this.exit(n);
}
function fT(n, a) {
  return a === "|" ? a : n;
}
function hT(n) {
  const a = n || {}, {
    tableCellPadding: u,
    tablePipeAlign: r,
    stringLength: c
  } = a, h = u ? " " : "|";
  return {
    handlers: {
      inlineCode: E,
      table: f,
      tableCell: m,
      tableRow: d
    },
    join: [dT],
    unsafe: [
      { character: "\r", inConstruct: "tableCell" },
      { character: `
`, inConstruct: "tableCell" },
      // A pipe, when followed by a tab or space (padding), or a dash or colon
      // (unpadded delimiter row), could result in a table.
      { atBreak: !0, character: "|", after: "[	 :-]" },
      // A pipe in a cell must be encoded.
      { character: "|", inConstruct: "tableCell" },
      // A colon must be followed by a dash, in which case it could start a
      // delimiter row.
      { atBreak: !0, character: ":", after: "-" },
      // A delimiter row can also start with a dash, when followed by more
      // dashes, a colon, or a pipe.
      // This is a stricter version than the built in check for lists, thematic
      // breaks, and setex heading underlines though:
      // <https://github.com/syntax-tree/mdast-util-to-markdown/blob/51a2038/lib/unsafe.js#L57>
      { atBreak: !0, character: "-", after: "[:|-]" }
    ]
  };
  function f(v, A, w, q) {
    const z = y(v, w, q), X = z[0];
    if (X) {
      let U = v.align ? v.align.length : 0, W = -1;
      if (!U)
        for (; ++W < z.length; )
          z[W].length > U && (U = z[W].length);
      for (; X.length < U; ) X.push("");
    }
    return p(z, v.align);
  }
  function d(v, A, w, q) {
    const z = b(v, w, q), X = p([z]);
    return X.slice(0, X.indexOf(`
`));
  }
  function m(v, A, w, q) {
    const z = w.enter("tableCell"), X = w.enter("phrasing"), U = w.containerPhrasing(v, {
      ...q,
      before: h,
      after: h
    });
    return X(), z(), U;
  }
  function p(v, A) {
    return Sx(v, {
      align: A,
      alignDelimiters: r,
      fillRows: !1,
      padding: u,
      stringLength: c
    });
  }
  function y(v, A, w) {
    const { children: q } = v;
    let z = -1;
    const X = [], U = A.enter("table");
    for (; ++z < q.length; )
      X[z] = b(q[z], A, w);
    return U(), X;
  }
  function b(v, A, w) {
    const { children: q } = v;
    let z = -1;
    const X = [], U = A.enter("tableRow");
    for (; ++z < q.length; )
      X[z] = m(q[z], v, A, w);
    return U(), X;
  }
  function E(v, A, w) {
    const q = ps.inlineCode(v, A, w);
    if (!w.stack.includes("tableCell")) return q;
    const z = [];
    let X = 0, U = q.indexOf("|");
    for (; U !== -1; ) {
      let W = U;
      for (; W > X && q.charCodeAt(W - 1) === 92; )
        W--;
      z.push(q.slice(X, U)), (U - W) % 2 === 0 && z.push("\\"), X = U, U = q.indexOf("|", U + 1);
    }
    return z.push(q.slice(X)), z.join("");
  }
}
function dT(n, a, u, r) {
  if (n.type === "table" && u.type === "listItem" && u.spread === !1 && (a.type === "definition" || a.type === "heading" && pT(a, r) || a.type === "paragraph" || a.type === "table"))
    return 1;
}
function pT(n, a) {
  let u = !1;
  return dr(n, function(r) {
    if (r.type === "break" || "value" in r && /\r?\n|\r/.test(r.value))
      return u = !0, wa;
  }), !!((!n.depth || n.depth < 3) && or(n) && (a.options.setext || u));
}
function mT() {
  return {
    exit: {
      taskListCheckValueChecked: Rm,
      taskListCheckValueUnchecked: Rm,
      paragraph: yT
    }
  };
}
function gT() {
  return {
    handlers: { paragraph: bT },
    join: [vT]
  };
}
function Rm(n) {
  const a = this.stack[this.stack.length - 2];
  a.type, a.checked = n.type === "taskListCheckValueChecked";
}
function yT(n) {
  const a = this.stack[this.stack.length - 2];
  if (a && a.type === "listItem" && typeof a.checked == "boolean") {
    const u = this.stack[this.stack.length - 1];
    u.type;
    const r = u.children[0];
    if (r && r.type === "text") {
      const c = a.children;
      let h = -1, f;
      for (; ++h < c.length; ) {
        const d = c[h];
        if (d.type === "paragraph") {
          f = d;
          break;
        }
      }
      f === u && (r.value = r.value.slice(1), r.value.length === 0 ? u.children.shift() : u.position && r.position && typeof r.position.start.offset == "number" && (r.position.start.column++, r.position.start.offset++, u.position.start = { ...r.position.start }));
    }
  }
  this.exit(n);
}
function bT(n, a, u, r) {
  if (!a || a.type !== "listItem" || Lg(a) !== n)
    return ps.paragraph(n, a, u, r);
  const c = "[" + (a.checked ? "x" : " ") + "] ", h = u.createTracker(r);
  h.move(c);
  const f = ps.paragraph(
    n.children.length > 0 ? n : { type: "paragraph", children: [{ type: "text", value: " " }] },
    a,
    u,
    { ...r, ...h.current() }
  );
  return c + f;
}
function vT(n, a, u) {
  if (!(n.type === "definition" && u.type === "listItem"))
    return;
  const r = Lg(u);
  if (r && u.children.indexOf(n) < u.children.indexOf(r))
    return 0;
}
function Lg(n) {
  if (typeof n.checked == "boolean")
    for (const a of n.children) {
      if (a.type === "paragraph")
        return a;
      if (a.type !== "definition")
        return;
    }
}
function ST() {
  return [
    jE(),
    cx(),
    dx(),
    uT(),
    mT()
  ];
}
function ET(n) {
  return {
    extensions: [
      qE(),
      sx(n),
      px(),
      hT(n),
      gT()
    ]
  };
}
const xT = {
  tokenize: zT,
  partial: !0
}, Bg = {
  tokenize: wT,
  partial: !0
}, Hg = {
  tokenize: DT,
  partial: !0
}, jg = {
  tokenize: OT,
  partial: !0
}, TT = {
  tokenize: NT,
  partial: !0
}, qg = {
  name: "wwwAutolink",
  tokenize: _T,
  previous: Vg
}, Ig = {
  name: "protocolAutolink",
  tokenize: kT,
  previous: Yg
}, Mn = {
  name: "emailAutolink",
  tokenize: CT,
  previous: Gg
}, dn = {};
function AT() {
  return {
    text: dn
  };
}
let zl = 48;
for (; zl < 123; )
  dn[zl] = Mn, zl++, zl === 58 ? zl = 65 : zl === 91 && (zl = 97);
dn[43] = Mn;
dn[45] = Mn;
dn[46] = Mn;
dn[95] = Mn;
dn[72] = [Mn, Ig];
dn[104] = [Mn, Ig];
dn[87] = [Mn, qg];
dn[119] = [Mn, qg];
function CT(n, a, u) {
  const r = this;
  let c, h;
  return f;
  function f(b) {
    return !ms(b) || !Gg.call(r, r.previous) || Bs(r.events) ? u(b) : (n.enter("literalAutolink"), n.enter("literalAutolinkEmail"), d(b));
  }
  function d(b) {
    return ms(b) ? (n.consume(b), d) : b === 64 ? (n.consume(b), m) : u(b);
  }
  function m(b) {
    return b === 46 ? n.check(TT, y, p)(b) : b === 45 || b === 95 || ye(b) ? (h = !0, n.consume(b), m) : y(b);
  }
  function p(b) {
    return n.consume(b), c = !0, m;
  }
  function y(b) {
    return h && c && ge(r.previous) ? (n.exit("literalAutolinkEmail"), n.exit("literalAutolink"), a(b)) : u(b);
  }
}
function _T(n, a, u) {
  const r = this;
  return c;
  function c(f) {
    return f !== 87 && f !== 119 || !Vg.call(r, r.previous) || Bs(r.events) ? u(f) : (n.enter("literalAutolink"), n.enter("literalAutolinkWww"), n.check(xT, n.attempt(Bg, n.attempt(Hg, h), u), u)(f));
  }
  function h(f) {
    return n.exit("literalAutolinkWww"), n.exit("literalAutolink"), a(f);
  }
}
function kT(n, a, u) {
  const r = this;
  let c = "", h = !1;
  return f;
  function f(b) {
    return (b === 72 || b === 104) && Yg.call(r, r.previous) && !Bs(r.events) ? (n.enter("literalAutolink"), n.enter("literalAutolinkHttp"), c += String.fromCodePoint(b), n.consume(b), d) : u(b);
  }
  function d(b) {
    if (ge(b) && c.length < 5)
      return c += String.fromCodePoint(b), n.consume(b), d;
    if (b === 58) {
      const E = c.toLowerCase();
      if (E === "http" || E === "https")
        return n.consume(b), m;
    }
    return u(b);
  }
  function m(b) {
    return b === 47 ? (n.consume(b), h ? p : (h = !0, m)) : u(b);
  }
  function p(b) {
    return b === null || nr(b) || Yt(b) || Nl(b) || Na(b) ? u(b) : n.attempt(Bg, n.attempt(Hg, y), u)(b);
  }
  function y(b) {
    return n.exit("literalAutolinkHttp"), n.exit("literalAutolink"), a(b);
  }
}
function zT(n, a, u) {
  let r = 0;
  return c;
  function c(f) {
    return (f === 87 || f === 119) && r < 3 ? (r++, n.consume(f), c) : f === 46 && r === 3 ? (n.consume(f), h) : u(f);
  }
  function h(f) {
    return f === null ? u(f) : a(f);
  }
}
function wT(n, a, u) {
  let r, c, h;
  return f;
  function f(p) {
    return p === 46 || p === 95 ? n.check(jg, m, d)(p) : p === null || Yt(p) || Nl(p) || p !== 45 && Na(p) ? m(p) : (h = !0, n.consume(p), f);
  }
  function d(p) {
    return p === 95 ? r = !0 : (c = r, r = void 0), n.consume(p), f;
  }
  function m(p) {
    return c || r || !h ? u(p) : a(p);
  }
}
function DT(n, a) {
  let u = 0, r = 0;
  return c;
  function c(f) {
    return f === 40 ? (u++, n.consume(f), c) : f === 41 && r < u ? h(f) : f === 33 || f === 34 || f === 38 || f === 39 || f === 41 || f === 42 || f === 44 || f === 46 || f === 58 || f === 59 || f === 60 || f === 63 || f === 93 || f === 95 || f === 126 ? n.check(jg, a, h)(f) : f === null || Yt(f) || Nl(f) ? a(f) : (n.consume(f), c);
  }
  function h(f) {
    return f === 41 && r++, n.consume(f), c;
  }
}
function OT(n, a, u) {
  return r;
  function r(d) {
    return d === 33 || d === 34 || d === 39 || d === 41 || d === 42 || d === 44 || d === 46 || d === 58 || d === 59 || d === 63 || d === 95 || d === 126 ? (n.consume(d), r) : d === 38 ? (n.consume(d), h) : d === 93 ? (n.consume(d), c) : (
      // `<` is an end.
      d === 60 || // So is whitespace.
      d === null || Yt(d) || Nl(d) ? a(d) : u(d)
    );
  }
  function c(d) {
    return d === null || d === 40 || d === 91 || Yt(d) || Nl(d) ? a(d) : r(d);
  }
  function h(d) {
    return ge(d) ? f(d) : u(d);
  }
  function f(d) {
    return d === 59 ? (n.consume(d), r) : ge(d) ? (n.consume(d), f) : u(d);
  }
}
function NT(n, a, u) {
  return r;
  function r(h) {
    return n.consume(h), c;
  }
  function c(h) {
    return ye(h) ? u(h) : a(h);
  }
}
function Vg(n) {
  return n === null || n === 40 || n === 42 || n === 95 || n === 91 || n === 93 || n === 126 || Yt(n);
}
function Yg(n) {
  return !ge(n);
}
function Gg(n) {
  return !(n === 47 || ms(n));
}
function ms(n) {
  return n === 43 || n === 45 || n === 46 || n === 95 || ye(n);
}
function Bs(n) {
  let a = n.length, u = !1;
  for (; a--; ) {
    const r = n[a][1];
    if ((r.type === "labelLink" || r.type === "labelImage") && !r._balanced) {
      u = !0;
      break;
    }
    if (r._gfmAutolinkLiteralWalkedInto) {
      u = !1;
      break;
    }
  }
  return n.length > 0 && !u && (n[n.length - 1][1]._gfmAutolinkLiteralWalkedInto = !0), u;
}
const RT = {
  tokenize: IT,
  partial: !0
};
function MT() {
  return {
    document: {
      91: {
        name: "gfmFootnoteDefinition",
        tokenize: HT,
        continuation: {
          tokenize: jT
        },
        exit: qT
      }
    },
    text: {
      91: {
        name: "gfmFootnoteCall",
        tokenize: BT
      },
      93: {
        name: "gfmPotentialFootnoteCall",
        add: "after",
        tokenize: UT,
        resolveTo: LT
      }
    }
  };
}
function UT(n, a, u) {
  const r = this;
  let c = r.events.length;
  const h = r.parser.gfmFootnotes || (r.parser.gfmFootnotes = []);
  let f;
  for (; c--; ) {
    const m = r.events[c][1];
    if (m.type === "labelImage") {
      f = m;
      break;
    }
    if (m.type === "gfmFootnoteCall" || m.type === "labelLink" || m.type === "label" || m.type === "image" || m.type === "link")
      break;
  }
  return d;
  function d(m) {
    if (!f || !f._balanced)
      return u(m);
    const p = an(r.sliceSerialize({
      start: f.end,
      end: r.now()
    }));
    return p.codePointAt(0) !== 94 || !h.includes(p.slice(1)) ? u(m) : (n.enter("gfmFootnoteCallLabelMarker"), n.consume(m), n.exit("gfmFootnoteCallLabelMarker"), a(m));
  }
}
function LT(n, a) {
  let u = n.length;
  for (; u--; )
    if (n[u][1].type === "labelImage" && n[u][0] === "enter") {
      n[u][1];
      break;
    }
  n[u + 1][1].type = "data", n[u + 3][1].type = "gfmFootnoteCallLabelMarker";
  const r = {
    type: "gfmFootnoteCall",
    start: Object.assign({}, n[u + 3][1].start),
    end: Object.assign({}, n[n.length - 1][1].end)
  }, c = {
    type: "gfmFootnoteCallMarker",
    start: Object.assign({}, n[u + 3][1].end),
    end: Object.assign({}, n[u + 3][1].end)
  };
  c.end.column++, c.end.offset++, c.end._bufferIndex++;
  const h = {
    type: "gfmFootnoteCallString",
    start: Object.assign({}, c.end),
    end: Object.assign({}, n[n.length - 1][1].start)
  }, f = {
    type: "chunkString",
    contentType: "string",
    start: Object.assign({}, h.start),
    end: Object.assign({}, h.end)
  }, d = [
    // Take the `labelImageMarker` (now `data`, the `!`)
    n[u + 1],
    n[u + 2],
    ["enter", r, a],
    // The `[`
    n[u + 3],
    n[u + 4],
    // The `^`.
    ["enter", c, a],
    ["exit", c, a],
    // Everything in between.
    ["enter", h, a],
    ["enter", f, a],
    ["exit", f, a],
    ["exit", h, a],
    // The ending (`]`, properly parsed and labelled).
    n[n.length - 2],
    n[n.length - 1],
    ["exit", r, a]
  ];
  return n.splice(u, n.length - u + 1, ...d), n;
}
function BT(n, a, u) {
  const r = this, c = r.parser.gfmFootnotes || (r.parser.gfmFootnotes = []);
  let h = 0, f;
  return d;
  function d(b) {
    return n.enter("gfmFootnoteCall"), n.enter("gfmFootnoteCallLabelMarker"), n.consume(b), n.exit("gfmFootnoteCallLabelMarker"), m;
  }
  function m(b) {
    return b !== 94 ? u(b) : (n.enter("gfmFootnoteCallMarker"), n.consume(b), n.exit("gfmFootnoteCallMarker"), n.enter("gfmFootnoteCallString"), n.enter("chunkString").contentType = "string", p);
  }
  function p(b) {
    if (
      // Too long.
      h > 999 || // Closing brace with nothing.
      b === 93 && !f || // Space or tab is not supported by GFM for some reason.
      // `\n` and `[` not being supported makes sense.
      b === null || b === 91 || Yt(b)
    )
      return u(b);
    if (b === 93) {
      n.exit("chunkString");
      const E = n.exit("gfmFootnoteCallString");
      return c.includes(an(r.sliceSerialize(E))) ? (n.enter("gfmFootnoteCallLabelMarker"), n.consume(b), n.exit("gfmFootnoteCallLabelMarker"), n.exit("gfmFootnoteCall"), a) : u(b);
    }
    return Yt(b) || (f = !0), h++, n.consume(b), b === 92 ? y : p;
  }
  function y(b) {
    return b === 91 || b === 92 || b === 93 ? (n.consume(b), h++, p) : p(b);
  }
}
function HT(n, a, u) {
  const r = this, c = r.parser.gfmFootnotes || (r.parser.gfmFootnotes = []);
  let h, f = 0, d;
  return m;
  function m(A) {
    return n.enter("gfmFootnoteDefinition")._container = !0, n.enter("gfmFootnoteDefinitionLabel"), n.enter("gfmFootnoteDefinitionLabelMarker"), n.consume(A), n.exit("gfmFootnoteDefinitionLabelMarker"), p;
  }
  function p(A) {
    return A === 94 ? (n.enter("gfmFootnoteDefinitionMarker"), n.consume(A), n.exit("gfmFootnoteDefinitionMarker"), n.enter("gfmFootnoteDefinitionLabelString"), n.enter("chunkString").contentType = "string", y) : u(A);
  }
  function y(A) {
    if (
      // Too long.
      f > 999 || // Closing brace with nothing.
      A === 93 && !d || // Space or tab is not supported by GFM for some reason.
      // `\n` and `[` not being supported makes sense.
      A === null || A === 91 || Yt(A)
    )
      return u(A);
    if (A === 93) {
      n.exit("chunkString");
      const w = n.exit("gfmFootnoteDefinitionLabelString");
      return h = an(r.sliceSerialize(w)), n.enter("gfmFootnoteDefinitionLabelMarker"), n.consume(A), n.exit("gfmFootnoteDefinitionLabelMarker"), n.exit("gfmFootnoteDefinitionLabel"), E;
    }
    return Yt(A) || (d = !0), f++, n.consume(A), A === 92 ? b : y;
  }
  function b(A) {
    return A === 91 || A === 92 || A === 93 ? (n.consume(A), f++, y) : y(A);
  }
  function E(A) {
    return A === 58 ? (n.enter("definitionMarker"), n.consume(A), n.exit("definitionMarker"), c.includes(h) || c.push(h), Nt(n, v, "gfmFootnoteDefinitionWhitespace")) : u(A);
  }
  function v(A) {
    return a(A);
  }
}
function jT(n, a, u) {
  return n.check(Ra, a, n.attempt(RT, a, u));
}
function qT(n) {
  n.exit("gfmFootnoteDefinition");
}
function IT(n, a, u) {
  const r = this;
  return Nt(n, c, "gfmFootnoteDefinitionIndent", 5);
  function c(h) {
    const f = r.events[r.events.length - 1];
    return f && f[1].type === "gfmFootnoteDefinitionIndent" && f[2].sliceSerialize(f[1], !0).length === 4 ? a(h) : u(h);
  }
}
function VT(n) {
  let u = (n || {}).singleTilde;
  const r = {
    name: "strikethrough",
    tokenize: h,
    resolveAll: c
  };
  return u == null && (u = !0), {
    text: {
      126: r
    },
    insideSpan: {
      null: [r]
    },
    attentionMarkers: {
      null: [126]
    }
  };
  function c(f, d) {
    let m = -1;
    for (; ++m < f.length; )
      if (f[m][0] === "enter" && f[m][1].type === "strikethroughSequenceTemporary" && f[m][1]._close) {
        let p = m;
        for (; p--; )
          if (f[p][0] === "exit" && f[p][1].type === "strikethroughSequenceTemporary" && f[p][1]._open && // If the sizes are the same:
          f[m][1].end.offset - f[m][1].start.offset === f[p][1].end.offset - f[p][1].start.offset) {
            f[m][1].type = "strikethroughSequence", f[p][1].type = "strikethroughSequence";
            const y = {
              type: "strikethrough",
              start: Object.assign({}, f[p][1].start),
              end: Object.assign({}, f[m][1].end)
            }, b = {
              type: "strikethroughText",
              start: Object.assign({}, f[p][1].end),
              end: Object.assign({}, f[m][1].start)
            }, E = [["enter", y, d], ["enter", f[p][1], d], ["exit", f[p][1], d], ["enter", b, d]], v = d.parser.constructs.insideSpan.null;
            v && ln(E, E.length, 0, cr(v, f.slice(p + 1, m), d)), ln(E, E.length, 0, [["exit", b, d], ["enter", f[m][1], d], ["exit", f[m][1], d], ["exit", y, d]]), ln(f, p - 1, m - p + 3, E), m = p + E.length - 2;
            break;
          }
      }
    for (m = -1; ++m < f.length; )
      f[m][1].type === "strikethroughSequenceTemporary" && (f[m][1].type = "data");
    return f;
  }
  function h(f, d, m) {
    const p = this.previous, y = this.events;
    let b = 0;
    return E;
    function E(A) {
      return p === 126 && y[y.length - 1][1].type !== "characterEscape" ? m(A) : (f.enter("strikethroughSequenceTemporary"), v(A));
    }
    function v(A) {
      const w = rl(p);
      if (A === 126)
        return b > 1 ? m(A) : (f.consume(A), b++, v);
      if (b < 2 && !u) return m(A);
      const q = f.exit("strikethroughSequenceTemporary"), z = rl(A);
      return q._open = !z || z === 2 && !!w, q._close = !w || w === 2 && !!z, d(A);
    }
  }
}
class YT {
  /**
   * Create a new edit map.
   */
  constructor() {
    this.map = [], this.index = /* @__PURE__ */ new Map();
  }
  /**
   * Create an edit: a remove and/or add at a certain place.
   *
   * @param {number} index
   *   Index at which to apply the edit.
   * @param {number} remove
   *   Count of items to remove at the index.
   * @param {Array<Event>} add
   *   Items to add at the index.
   * @returns {undefined}
   *   Nothing.
   */
  add(a, u, r) {
    GT(this, a, u, r);
  }
  // To do: add this when moving to `micromark`.
  // /**
  //  * Create an edit: but insert `add` before existing additions.
  //  *
  //  * @param {number} index
  //  * @param {number} remove
  //  * @param {Array<Event>} add
  //  * @returns {undefined}
  //  */
  // addBefore(index, remove, add) {
  //   addImplementation(this, index, remove, add, true)
  // }
  /**
   * Done, change the events.
   *
   * @param {Array<Event>} events
   *   List of events to apply the edits to.
   * @returns {undefined}
   *   Nothing.
   */
  consume(a) {
    if (this.map.sort(function(h, f) {
      return h[0] - f[0];
    }), this.map.length === 0)
      return;
    let u = this.map.length;
    const r = [];
    for (; u > 0; )
      u -= 1, r.push(a.slice(this.map[u][0] + this.map[u][1]), this.map[u][2]), a.length = this.map[u][0];
    r.push(a.slice()), a.length = 0;
    let c = r.pop();
    for (; c; ) {
      for (const h of c)
        a.push(h);
      c = r.pop();
    }
    this.map.length = 0, this.index.clear();
  }
}
function GT(n, a, u, r) {
  if (u === 0 && r.length === 0)
    return;
  const c = n.index.get(a);
  if (c) {
    c[1] += u, c[2].push(...r);
    return;
  }
  const h = [a, u, r];
  n.map.push(h), n.index.set(a, h);
}
function QT(n, a) {
  let u = !1;
  const r = [];
  for (; a < n.length; ) {
    const c = n[a];
    if (u) {
      if (c[0] === "enter")
        c[1].type === "tableContent" && r.push(n[a + 1][1].type === "tableDelimiterMarker" ? "left" : "none");
      else if (c[1].type === "tableContent") {
        if (n[a - 1][1].type === "tableDelimiterMarker") {
          const h = r.length - 1;
          r[h] = r[h] === "left" ? "center" : "right";
        }
      } else if (c[1].type === "tableDelimiterRow")
        break;
    } else c[0] === "enter" && c[1].type === "tableDelimiterRow" && (u = !0);
    a += 1;
  }
  return r;
}
function XT() {
  return {
    flow: {
      null: {
        name: "table",
        tokenize: ZT,
        resolveAll: KT
      }
    }
  };
}
function ZT(n, a, u) {
  const r = this;
  let c = 0, h = 0, f;
  return d;
  function d(B) {
    let F = r.events.length - 1;
    for (; F > -1; ) {
      const {
        type: P
      } = r.events[F][1];
      if (P === "lineEnding" || // Note: markdown-rs uses `whitespace` instead of `linePrefix`
      P === "linePrefix")
        F--;
      else
        break;
    }
    const nt = F > -1 ? r.events[F][1].type : null, Et = nt === "tableHead" || nt === "tableRow" ? H : m;
    return Et === H && r.parser.lazy[r.now().line] ? u(B) : Et(B);
  }
  function m(B) {
    return n.enter("tableHead"), n.enter("tableRow"), p(B);
  }
  function p(B) {
    return B === 124 || (f = !0, h += 1), y(B);
  }
  function y(B) {
    return B === null ? u(B) : ft(B) ? h > 1 ? (h = 0, r.interrupt = !0, n.exit("tableRow"), n.enter("lineEnding"), n.consume(B), n.exit("lineEnding"), v) : u(B) : St(B) ? Nt(n, y, "whitespace")(B) : (h += 1, f && (f = !1, c += 1), B === 124 ? (n.enter("tableCellDivider"), n.consume(B), n.exit("tableCellDivider"), f = !0, y) : (n.enter("data"), b(B)));
  }
  function b(B) {
    return B === null || B === 124 || Yt(B) ? (n.exit("data"), y(B)) : (n.consume(B), B === 92 ? E : b);
  }
  function E(B) {
    return B === 92 || B === 124 ? (n.consume(B), b) : b(B);
  }
  function v(B) {
    return r.interrupt = !1, r.parser.lazy[r.now().line] ? u(B) : (n.enter("tableDelimiterRow"), f = !1, St(B) ? Nt(n, A, "linePrefix", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(B) : A(B));
  }
  function A(B) {
    return B === 45 || B === 58 ? q(B) : B === 124 ? (f = !0, n.enter("tableCellDivider"), n.consume(B), n.exit("tableCellDivider"), w) : it(B);
  }
  function w(B) {
    return St(B) ? Nt(n, q, "whitespace")(B) : q(B);
  }
  function q(B) {
    return B === 58 ? (h += 1, f = !0, n.enter("tableDelimiterMarker"), n.consume(B), n.exit("tableDelimiterMarker"), z) : B === 45 ? (h += 1, z(B)) : B === null || ft(B) ? W(B) : it(B);
  }
  function z(B) {
    return B === 45 ? (n.enter("tableDelimiterFiller"), X(B)) : it(B);
  }
  function X(B) {
    return B === 45 ? (n.consume(B), X) : B === 58 ? (f = !0, n.exit("tableDelimiterFiller"), n.enter("tableDelimiterMarker"), n.consume(B), n.exit("tableDelimiterMarker"), U) : (n.exit("tableDelimiterFiller"), U(B));
  }
  function U(B) {
    return St(B) ? Nt(n, W, "whitespace")(B) : W(B);
  }
  function W(B) {
    return B === 124 ? A(B) : B === null || ft(B) ? !f || c !== h ? it(B) : (n.exit("tableDelimiterRow"), n.exit("tableHead"), a(B)) : it(B);
  }
  function it(B) {
    return u(B);
  }
  function H(B) {
    return n.enter("tableRow"), J(B);
  }
  function J(B) {
    return B === 124 ? (n.enter("tableCellDivider"), n.consume(B), n.exit("tableCellDivider"), J) : B === null || ft(B) ? (n.exit("tableRow"), a(B)) : St(B) ? Nt(n, J, "whitespace")(B) : (n.enter("data"), ct(B));
  }
  function ct(B) {
    return B === null || B === 124 || Yt(B) ? (n.exit("data"), J(B)) : (n.consume(B), B === 92 ? Ct : ct);
  }
  function Ct(B) {
    return B === 92 || B === 124 ? (n.consume(B), ct) : ct(B);
  }
}
function KT(n, a) {
  let u = -1, r = !0, c = 0, h = [0, 0, 0, 0], f = [0, 0, 0, 0], d = !1, m = 0, p, y, b;
  const E = new YT();
  for (; ++u < n.length; ) {
    const v = n[u], A = v[1];
    v[0] === "enter" ? A.type === "tableHead" ? (d = !1, m !== 0 && (Mm(E, a, m, p, y), y = void 0, m = 0), p = {
      type: "table",
      start: Object.assign({}, A.start),
      // Note: correct end is set later.
      end: Object.assign({}, A.end)
    }, E.add(u, 0, [["enter", p, a]])) : A.type === "tableRow" || A.type === "tableDelimiterRow" ? (r = !0, b = void 0, h = [0, 0, 0, 0], f = [0, u + 1, 0, 0], d && (d = !1, y = {
      type: "tableBody",
      start: Object.assign({}, A.start),
      // Note: correct end is set later.
      end: Object.assign({}, A.end)
    }, E.add(u, 0, [["enter", y, a]])), c = A.type === "tableDelimiterRow" ? 2 : y ? 3 : 1) : c && (A.type === "data" || A.type === "tableDelimiterMarker" || A.type === "tableDelimiterFiller") ? (r = !1, f[2] === 0 && (h[1] !== 0 && (f[0] = f[1], b = tr(E, a, h, c, void 0, b), h = [0, 0, 0, 0]), f[2] = u)) : A.type === "tableCellDivider" && (r ? r = !1 : (h[1] !== 0 && (f[0] = f[1], b = tr(E, a, h, c, void 0, b)), h = f, f = [h[1], u, 0, 0])) : A.type === "tableHead" ? (d = !0, m = u) : A.type === "tableRow" || A.type === "tableDelimiterRow" ? (m = u, h[1] !== 0 ? (f[0] = f[1], b = tr(E, a, h, c, u, b)) : f[1] !== 0 && (b = tr(E, a, f, c, u, b)), c = 0) : c && (A.type === "data" || A.type === "tableDelimiterMarker" || A.type === "tableDelimiterFiller") && (f[3] = u);
  }
  for (m !== 0 && Mm(E, a, m, p, y), E.consume(a.events), u = -1; ++u < a.events.length; ) {
    const v = a.events[u];
    v[0] === "enter" && v[1].type === "table" && (v[1]._align = QT(a.events, u));
  }
  return n;
}
function tr(n, a, u, r, c, h) {
  const f = r === 1 ? "tableHeader" : r === 2 ? "tableDelimiter" : "tableData", d = "tableContent";
  u[0] !== 0 && (h.end = Object.assign({}, Ei(a.events, u[0])), n.add(u[0], 0, [["exit", h, a]]));
  const m = Ei(a.events, u[1]);
  if (h = {
    type: f,
    start: Object.assign({}, m),
    // Note: correct end is set later.
    end: Object.assign({}, m)
  }, n.add(u[1], 0, [["enter", h, a]]), u[2] !== 0) {
    const p = Ei(a.events, u[2]), y = Ei(a.events, u[3]), b = {
      type: d,
      start: Object.assign({}, p),
      end: Object.assign({}, y)
    };
    if (n.add(u[2], 0, [["enter", b, a]]), r !== 2) {
      const E = a.events[u[2]], v = a.events[u[3]];
      if (E[1].end = Object.assign({}, v[1].end), E[1].type = "chunkText", E[1].contentType = "text", u[3] > u[2] + 1) {
        const A = u[2] + 1, w = u[3] - u[2] - 1;
        n.add(A, w, []);
      }
    }
    n.add(u[3] + 1, 0, [["exit", b, a]]);
  }
  return c !== void 0 && (h.end = Object.assign({}, Ei(a.events, c)), n.add(c, 0, [["exit", h, a]]), h = void 0), h;
}
function Mm(n, a, u, r, c) {
  const h = [], f = Ei(a.events, u);
  c && (c.end = Object.assign({}, f), h.push(["exit", c, a])), r.end = Object.assign({}, f), h.push(["exit", r, a]), n.add(u + 1, 0, h);
}
function Ei(n, a) {
  const u = n[a], r = u[0] === "enter" ? "start" : "end";
  return u[1][r];
}
const JT = {
  name: "tasklistCheck",
  tokenize: $T
};
function FT() {
  return {
    text: {
      91: JT
    }
  };
}
function $T(n, a, u) {
  const r = this;
  return c;
  function c(m) {
    return (
      // Exit if there’s stuff before.
      r.previous !== null || // Exit if not in the first content that is the first child of a list
      // item.
      !r._gfmTasklistFirstContentOfListItem ? u(m) : (n.enter("taskListCheck"), n.enter("taskListCheckMarker"), n.consume(m), n.exit("taskListCheckMarker"), h)
    );
  }
  function h(m) {
    return Yt(m) ? (n.enter("taskListCheckValueUnchecked"), n.consume(m), n.exit("taskListCheckValueUnchecked"), f) : m === 88 || m === 120 ? (n.enter("taskListCheckValueChecked"), n.consume(m), n.exit("taskListCheckValueChecked"), f) : u(m);
  }
  function f(m) {
    return m === 93 ? (n.enter("taskListCheckMarker"), n.consume(m), n.exit("taskListCheckMarker"), n.exit("taskListCheck"), d) : u(m);
  }
  function d(m) {
    return ft(m) ? a(m) : St(m) ? n.check({
      tokenize: WT
    }, a, u)(m) : u(m);
  }
}
function WT(n, a, u) {
  return Nt(n, r, "whitespace");
  function r(c) {
    return c === null ? u(c) : a(c);
  }
}
function PT(n) {
  return Fm([
    AT(),
    MT(),
    VT(n),
    XT(),
    FT()
  ]);
}
const tA = {};
function eA(n) {
  const a = (
    /** @type {Processor<Root>} */
    this
  ), u = n || tA, r = a.data(), c = r.micromarkExtensions || (r.micromarkExtensions = []), h = r.fromMarkdownExtensions || (r.fromMarkdownExtensions = []), f = r.toMarkdownExtensions || (r.toMarkdownExtensions = []);
  c.push(PT(u)), h.push(ST()), f.push(ET(u));
}
function nA({ session: n }) {
  const a = Rn.useSyncExternalStore(n.subscribe, n.getSnapshot), u = Rn.useRef(null), r = Rn.useRef(null), c = Rn.useRef(!0), [h, f] = Rn.useState(!1), [d, m] = Rn.useState(""), p = () => {
    const E = u.current;
    E && (E.scrollTop = E.scrollHeight, c.current = !0, f(!1));
  };
  Rn.useLayoutEffect(() => {
    c.current ? p() : f(!0);
  }, [a.messages]), Rn.useEffect(() => {
    const E = u.current;
    if (!E) return;
    const v = new ResizeObserver(() => {
      c.current && p();
    });
    return v.observe(E), () => v.disconnect();
  }, []), Rn.useLayoutEffect(() => {
    const E = r.current;
    E && (E.style.height = "auto", E.style.height = Math.min(E.scrollHeight, 160) + "px");
  }, [a.draft]);
  async function y(E) {
    m("");
    try {
      E === "send" && (c.current = !0, f(!1)), await n[E]();
    } catch {
      m(E === "send" ? "Delivery could not be confirmed. Refresh before sending again." : E === "stop" ? "Stop could not be confirmed. The run may still be active." : "Conversation could not be refreshed.");
    }
  }
  const b = ["sending", "streaming", "stopping"].includes(a.status);
  return /* @__PURE__ */ Mt.jsxs("section", { className: "starli-messenger", "aria-label": a.title + " conversation", children: [
    /* @__PURE__ */ Mt.jsxs("div", { className: "sm-status", role: "status", children: [
      a.status === "loading" ? "Loading conversation…" : a.status === "streaming" ? "Starli is replying" : a.status === "sending" ? "Sending…" : a.status === "stopping" ? "Stopping…" : a.status === "disconnected" ? "Connection paused" : a.status === "denied" ? "Access changed" : "",
      a.status === "disconnected" && /* @__PURE__ */ Mt.jsx("button", { type: "button", onClick: () => void y("refresh"), children: "Reconnect" })
    ] }),
    /* @__PURE__ */ Mt.jsxs("div", { ref: u, className: "sm-messages", role: "log", "aria-label": "Conversation messages", "aria-live": "off", onScroll: () => {
      const E = u.current;
      c.current = E.scrollHeight - E.scrollTop - E.clientHeight < 64, c.current && f(!1);
    }, children: [
      a.messages.map((E) => /* @__PURE__ */ Mt.jsxs("article", { "data-message-id": E.id, className: "sm-message sm-" + E.role, children: [
        /* @__PURE__ */ Mt.jsx("strong", { children: E.name || (E.role === "user" ? "You" : E.role === "assistant" ? "Starli" : "System") }),
        /* @__PURE__ */ Mt.jsx("div", { className: "sm-content", children: /* @__PURE__ */ Mt.jsx(wE, { remarkPlugins: [eA], skipHtml: !0, components: { a: (v) => /* @__PURE__ */ Mt.jsx("a", { ...v, target: "_blank", rel: "noopener noreferrer" }) }, children: E.content }) }),
        E.tools?.length ? /* @__PURE__ */ Mt.jsxs("details", { className: "sm-tools", children: [
          /* @__PURE__ */ Mt.jsx("summary", { children: "Tool progress" }),
          E.tools.map((v) => /* @__PURE__ */ Mt.jsxs("div", { children: [
            /* @__PURE__ */ Mt.jsx("span", { children: v.name }),
            /* @__PURE__ */ Mt.jsx("small", { children: v.status })
          ] }, v.id))
        ] }) : null,
        a.canReplyInThread && /* @__PURE__ */ Mt.jsx("button", { className: "sm-thread", type: "button", onClick: () => n.openThread?.(E.id), children: "Reply in thread" })
      ] }, E.id)),
      a.status === "ready" && !a.messages.length && /* @__PURE__ */ Mt.jsxs("p", { className: "sm-empty", children: [
        "Start a conversation with ",
        a.title,
        "."
      ] })
    ] }),
    h && /* @__PURE__ */ Mt.jsx("button", { type: "button", className: "sm-jump", onClick: p, children: "Latest messages ↓" }),
    (a.error || d) && /* @__PURE__ */ Mt.jsx("p", { className: "sm-error", role: "alert", children: a.error || d }),
    /* @__PURE__ */ Mt.jsxs("form", { className: "sm-composer", onSubmit: (E) => {
      E.preventDefault(), y("send");
    }, children: [
      /* @__PURE__ */ Mt.jsx("textarea", { ref: r, "aria-label": "Message", placeholder: "Ask Starli", rows: 1, value: a.draft, disabled: a.status === "denied" || a.status === "loading", onChange: (E) => n.setDraft(E.target.value), onKeyDown: (E) => {
        E.key === "Enter" && !E.shiftKey && !E.nativeEvent.isComposing && E.keyCode !== 229 && !matchMedia("(pointer: coarse)").matches && (E.preventDefault(), a.canSend && !b && y("send"));
      } }),
      b && a.canStop ? /* @__PURE__ */ Mt.jsx("button", { type: "button", className: "sm-send", "aria-label": "Stop response", disabled: a.status === "stopping", onClick: () => void y("stop"), children: /* @__PURE__ */ Mt.jsx("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", children: /* @__PURE__ */ Mt.jsx("rect", { x: "7", y: "7", width: "10", height: "10", rx: "1" }) }) }) : /* @__PURE__ */ Mt.jsx("button", { className: "sm-send", type: "submit", "aria-label": "Send message", disabled: !a.canSend || b || !a.draft.trim(), children: /* @__PURE__ */ Mt.jsx("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", children: /* @__PURE__ */ Mt.jsx("path", { d: "M12 19V5m-6 6 6-6 6 6", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }) }) })
    ] })
  ] });
}
const gs = (n, a) => n.ownerId === a.ownerId && n.companyId === a.companyId && n.membershipRevision === a.membershipRevision && n.conversationId === a.conversationId && n.agentId === a.agentId;
function lA(n, a, u) {
  let r = !1, c = !1, h = !1;
  const f = /* @__PURE__ */ new Set(), d = Object.freeze({ version: "starli.conversation.view.v1", scope: a, title: "Conversation", messages: [], draft: "", status: "denied", canSend: !1, canStop: !1, error: "Your conversation access changed. Reopen it to continue." });
  let m = d;
  function p() {
    const v = u();
    return !r && !!v && gs(a, v);
  }
  function y() {
    const v = n.getSnapshot();
    m = p() && v.version === "starli.conversation.view.v1" && gs(a, v.scope) ? v : d;
    for (const A of f) A();
  }
  const b = n.subscribe(y);
  y();
  async function E(v) {
    if (!p()) {
      y();
      return;
    }
    const A = m;
    if (!(v === "send" && (!A.canSend || !A.draft.trim() || c) || v === "stop" && (!A.canStop || h))) {
      v === "send" && (c = !0), v === "stop" && (h = !0);
      try {
        await n[v]();
      } finally {
        v === "send" && (c = !1), v === "stop" && (h = !1), y();
      }
    }
  }
  return { getSnapshot: () => p() ? m : d, subscribe(v) {
    return f.add(v), () => {
      f.delete(v);
    };
  }, setDraft(v) {
    p() && v.length <= 1e5 ? n.setDraft(v) : y();
  }, send: () => E("send"), stop: () => E("stop"), refresh: () => E("refresh"), openThread(v) {
    p() && m.canReplyInThread && m.messages.some((A) => A.id === v) && n.openThread?.(v);
  }, dispose() {
    if (!r) {
      r = !0, b(), m = d;
      for (const v of f) v();
      f.clear(), n.detach();
    }
  } };
}
function iA(n, a, u, r) {
  const c = lA(u(a), a, r), h = p0.createRoot(n, { identifierPrefix: "starli-" + a.conversationId + "-" });
  h.render(/* @__PURE__ */ Mt.jsx(nA, { session: c }));
  let f = !1;
  return { dispose() {
    f || (f = !0, h.unmount(), c.dispose());
  } };
}
const Ol = (n) => typeof n == "string" && /^[A-Za-z0-9_.:-]{1,180}$/.test(n), aA = /* @__PURE__ */ new Set(["RUNNING", "QUEUED", "PENDING", "NEEDS_INPUT", "WAITING_INPUT", "BUDGET_EXHAUSTED", "CANCEL_REQUESTED", "ANSWERED", "COMPLETED", "FAILED", "DENIED", "CANCELLED", "INTERRUPTED"]);
async function uA(n, a, u, r = fetch) {
  if (!n || typeof a != "string") return null;
  const c = new AbortController(), h = setTimeout(() => c.abort(), 4e3);
  try {
    const f = await r("/api/v1/starli/runs/capabilities", { headers: { Authorization: "Bearer " + n }, signal: c.signal, cache: "no-store" });
    if (!u()) throw Error("The conversation changed before this request was sent.");
    if ([401, 403].includes(f.status)) throw Error("Your session is not authorized.");
    if (!f.ok || !f.headers.get("content-type")?.includes("application/json")) return null;
    const d = await f.json();
    if (!u()) throw Error("The conversation changed before this request was sent.");
    const m = Array.isArray(d.nativeChatModelIds) ? d.nativeChatModelIds : typeof d.chatModelId == "string" ? [d.chatModelId] : [];
    return d.version !== "starli.run.v1" || d.toolEventsVersion !== "starli.tool.v1" || !m.includes(a) ? null : { model: a, readOnlyPreview: d.readOnlyPreview === !0, prepareTurn: d.prepareTurn === !0, prepareTurnVersion: typeof d.prepareTurnVersion == "string" ? d.prepareTurnVersion : null };
  } catch (f) {
    if (!u() || f.message === "Your session is not authorized.") throw f;
    return null;
  } finally {
    clearTimeout(h);
  }
}
function rA(n, a) {
  if (n?.model !== a.model || n?.stream !== !0 || !Ol(n?.chat_id) || !Ol(n?.id)) throw Error("Native runtime request did not match its prepared turn.");
  const u = { ...n };
  return delete u.session_id, { body: u, headers: { "X-Starli-Tool-Events": "v1" }, scope: { conversationId: n.chat_id, assistantMessageId: n.id, readOnlyPreview: a.readOnlyPreview } };
}
function oA(n, a) {
  const u = n.headers.get("X-Starli-Run-ID"), r = n.headers.get("X-Starli-Request-ID");
  if (!Ol(u) || !Ol(r)) throw Error("Live response binding is unavailable. Check this conversation before sending again.");
  return { ...a, runId: u, requestId: r };
}
function cA(n, a) {
  if (!n || n.runId !== a.runId || n.requestId !== a.requestId || n.conversationId !== a.conversationId || n.assistantMessageId !== a.assistantMessageId || !Ol(n.agentId) || !Number.isSafeInteger(n.seq) || n.seq < 0 || typeof n.timestamp != "number" || !Number.isFinite(n.timestamp) || n.timestamp <= 0) return null;
  const u = { ...a, agentId: n.agentId, taskId: Ol(n.taskId) ? n.taskId : null, seq: n.seq, timestamp: n.timestamp };
  if (n.version === "starli.tool.v1" && n.type === "tool.lifecycle") {
    if (!Ol(n.toolCallId) || typeof n.publicToolName != "string" || !/^\w[\w.:-]{0,99}$/.test(n.publicToolName) || !["running", "succeeded", "failed", "cancelled"].includes(n.status) || n.status !== "running" && !["COMPLETED", "QUEUED", "PENDING", "NEEDS_INPUT", "DENIED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(n.resultCode)) return null;
    const r = sA(n);
    return { ...u, version: "starli.tool.v1", type: "tool.lifecycle", toolCallId: n.toolCallId, publicToolName: n.publicToolName, status: n.status, ...n.status !== "running" ? { resultCode: n.resultCode } : {}, ...r ? { publicOutcome: r } : {}, ...Number.isInteger(n.durationMs) && n.durationMs >= 0 && n.durationMs <= 864e5 ? { durationMs: n.durationMs } : {} };
  }
  return n.version === "starli.run.v1" && n.type === "run.state" && aA.has(n.status) ? { ...u, version: "starli.run.v1", type: "run.state", status: n.status, objectiveComplete: n.objectiveComplete === !0, needsInput: n.needsInput === !0 } : null;
}
function sA(n) {
  return n?.publicToolName !== "web_search" || !["succeeded", "failed"].includes(n.status) || !["COMPLETED", "FAILED"].includes(n.resultCode) ? null : n.publicOutcome === "EMPTY" || n.publicOutcome === "RATE_LIMITED" ? n.publicOutcome : null;
}
const fA = /* @__PURE__ */ new Set(["TURN_PREVIEW_ADMIN_REQUIRED", "TURN_ATTACHMENTS_NOT_AVAILABLE", "TURN_CONTENT_INVALID", "TURN_TEXT_PARTS_ONLY", "TURN_NATIVE_SESSION_REQUIRED", "TURN_MODEL_SELECTOR_INVALID", "TURN_IDS_MUST_DIFFER", "TURN_HISTORY_INVALID", "TURN_ID_REUSED", "TURN_MESSAGE_ID_EXISTS", "TURN_ACTIVE_RUN_EXISTS", "TURN_CURRENT_ID_CONFLICT", "TURN_ACTIVE_ASSISTANT_EXISTS", "TURN_PARENT_MISSING", "PROJECT_HOSTED_AGENT_REQUIRED", "PROJECT_HOSTED_MODEL_NOT_CONFIGURED", "PROJECT_AGENT_BINDING_CHANGED", "PROJECT_AGENT_NOT_ACTIVE", "PROJECT_AGENT_UNAVAILABLE", "PROJECT_AGENT_LIMIT", "PROJECT_SCOPE_REVOKED", "PROJECT_ACCOUNT_UNAVAILABLE", "ADMIN_HOSTED_AGENT_REQUIRED", "ADMIN_HOSTED_MODEL_NOT_CONFIGURED", "ADMIN_SCOPE_CHANGED", "ADMIN_SCOPE_REVOKED", "ADMIN_ROLE_REQUIRED", "ADMIN_AGENT_UNAVAILABLE", "ADMIN_GRANT_REVOKED", "ACCOUNT_PROVIDER_NOT_CONNECTED", "ACCOUNT_PROVIDER_CHANGED", "ACCOUNT_PROVIDER_REVISION_CHANGED", "PROVIDER_CONNECTION_REQUIRED", "PROVIDER_CONNECTION_CHANGED", "PROVIDER_CONNECTION_REVISION_CHANGED", "PROVIDER_CONNECTION_IN_PROGRESS", "PROVIDER_CONNECTION_STEP_CHANGED", "AUTH_CONNECTION_REQUIRED", "AUTH_CONNECTION_CHANGED", "AUTH_CONNECTION_REVISION_CHANGED"]);
class Ca extends Error {
  constructor(a, u) {
    super(a), this.code = a, this.status = u, this.name = "NativeTurnError";
  }
}
function hA(n) {
  if (!(n instanceof Ca)) return null;
  const a = { TURN_PREVIEW_ADMIN_REQUIRED: "This runtime is unavailable for this account.", TURN_NATIVE_SESSION_REQUIRED: "Your native session could not be confirmed. Sign in again.", TURN_ATTACHMENTS_NOT_AVAILABLE: "Attachments are not supported by this runtime.", TURN_CONTENT_INVALID: "The message format was rejected.", TURN_TEXT_PARTS_ONLY: "This runtime accepts text messages only.", TURN_MODEL_SELECTOR_INVALID: "The selected model no longer matches this runtime. Reload the model list.", TURN_ACTIVE_RUN_EXISTS: "The server still has an active run for this conversation. Refresh its status.", TURN_ACTIVE_ASSISTANT_EXISTS: "The server still marks the previous response as unfinished. Refresh its status.", TURN_CURRENT_ID_CONFLICT: "The conversation changed before admission. Refresh before sending again.", TURN_PARENT_MISSING: "The selected conversation branch is no longer available.", TURN_HISTORY_INVALID: "The server could not validate this conversation history.", TURN_ID_REUSED: "The turn identifier conflicts with a recorded request.", TURN_MESSAGE_ID_EXISTS: "The message identifiers are already present. Refresh before sending again.", TURN_NETWORK_UNCONFIRMED: "Turn preparation could not reach the server.", TURN_RESPONSE_INVALID: "Turn preparation returned an unexpected response.", TURN_RECEIPT_MISMATCH: "The preparation receipt did not match this conversation.", TURN_REJECTED: "Turn preparation was rejected by the server.", PROJECT_HOSTED_AGENT_REQUIRED: "This runtime route requires a hosted agent; your account provider was not changed.", ADMIN_HOSTED_AGENT_REQUIRED: "This administrator runtime route requires a hosted agent; your account provider was not changed.", PROJECT_HOSTED_MODEL_NOT_CONFIGURED: "The hosted model required by this runtime route is unavailable.", ADMIN_HOSTED_MODEL_NOT_CONFIGURED: "The hosted model required by this administrator route is unavailable.", PROJECT_AGENT_BINDING_CHANGED: "The agent binding changed. Reopen this conversation.", PROJECT_AGENT_NOT_ACTIVE: "The agent is not currently available for a new turn.", PROJECT_AGENT_UNAVAILABLE: "The conversation agent is unavailable.", PROJECT_AGENT_LIMIT: "The workspace agent limit was reached.", PROJECT_SCOPE_REVOKED: "Access to this runtime changed.", PROJECT_ACCOUNT_UNAVAILABLE: "This account cannot access this runtime.", ADMIN_SCOPE_CHANGED: "Your administrator grant or agent revision changed. Reopen this conversation.", ADMIN_SCOPE_REVOKED: "Your administrator runtime grant was revoked.", ADMIN_ROLE_REQUIRED: "The current administrator role is required.", ADMIN_AGENT_UNAVAILABLE: "This administrator agent is unavailable.", ADMIN_GRANT_REVOKED: "This agent no longer has an active administrator grant.", ACCOUNT_PROVIDER_NOT_CONNECTED: "Connect your account provider before sending.", ACCOUNT_PROVIDER_CHANGED: "Your account provider changed. Reopen the conversation.", ACCOUNT_PROVIDER_REVISION_CHANGED: "Your account provider connection changed. Reopen the conversation.", PROVIDER_CONNECTION_REQUIRED: "Connect your selected provider before sending.", PROVIDER_CONNECTION_CHANGED: "Your provider connection changed. Reopen the conversation.", PROVIDER_CONNECTION_REVISION_CHANGED: "Your provider connection revision changed. Reopen the conversation.", PROVIDER_CONNECTION_IN_PROGRESS: "Finish or cancel the active provider connection first.", PROVIDER_CONNECTION_STEP_CHANGED: "Your provider connection step changed. Reopen provider settings.", AUTH_CONNECTION_REQUIRED: "Sign in to your selected provider before sending.", AUTH_CONNECTION_CHANGED: "Your provider sign-in changed. Reopen the conversation.", AUTH_CONNECTION_REVISION_CHANGED: "Your provider sign-in revision changed. Reopen the conversation." };
  return (a[n.code] || a.TURN_REJECTED) + " [" + n.code + (n.status ? "; HTTP " + n.status : "") + "] Your text is kept; no duplicate request was sent.";
}
async function dA(n, a, u, r, c, h = fetch) {
  if (!r.prepareTurn || r.prepareTurnVersion !== "starli.chat.turn.v1" || r.model !== u.model) throw Error("This server cannot safely prepare a runtime turn.");
  if (!c()) throw Error("The conversation changed before preparation.");
  const f = await h("/api/v1/starli/runs/chats/" + encodeURIComponent(a) + "/prepare-turn", { method: "POST", headers: { Authorization: "Bearer " + n, "Content-Type": "application/json" }, body: JSON.stringify(u) }).catch(() => {
    throw new Ca("TURN_NETWORK_UNCONFIRMED", 0);
  });
  if (!c()) throw Error("The conversation changed after preparation. Check its history before sending again.");
  if (!f.headers.get("content-type")?.includes("application/json")) throw new Ca("TURN_RESPONSE_INVALID", f.status);
  const d = await f.json().catch(() => null);
  if (!c()) throw Error("The conversation changed after preparation. Check its history before sending again.");
  if (!f.ok) {
    const m = { "Connect this provider before selecting its model": "ACCOUNT_PROVIDER_NOT_CONNECTED", "Connect this provider first": "ACCOUNT_PROVIDER_NOT_CONNECTED", "Finish or cancel your current provider connection": "PROVIDER_CONNECTION_IN_PROGRESS", "The connection step has changed": "PROVIDER_CONNECTION_STEP_CHANGED" }, p = typeof d?.detail == "string" ? d.detail : typeof d?.code == "string" ? d.code : typeof d?.detail?.code == "string" ? d.detail.code : "", y = fA.has(p) ? p : m[p] || "TURN_REJECTED";
    throw new Ca(y, f.status);
  }
  if (d?.version !== "starli.chat.turn.v1" || d.conversationId !== a || d.turnId !== u.turnId || d.userMessageId !== u.userMessageId || d.assistantMessageId !== u.assistantMessageId || d.currentId !== u.assistantMessageId || d.model !== u.model || typeof d.deduplicated != "boolean") throw new Ca("TURN_RECEIPT_MISMATCH", f.status);
  return { capability: r, conversationId: a, turnId: d.turnId, userMessageId: d.userMessageId, assistantMessageId: d.assistantMessageId, model: d.model };
}
const Um = /* @__PURE__ */ new Set(["ANSWERED", "COMPLETED", "FAILED", "DENIED", "CANCELLED", "INTERRUPTED", "NEEDS_INPUT", "WAITING_INPUT", "BUDGET_EXHAUSTED"]), Aa = (n) => typeof n == "string" && /^[A-Za-z0-9_.:-]{1,180}$/.test(n);
function pA(n, a, u = fetch, r) {
  if (n.companyId !== null || !n.conversationId && !n.agentId) throw Error("Personal conversation binding required.");
  const c = a().token, h = new AbortController(), f = /* @__PURE__ */ new Set();
  let d = n.conversationId, m = null, p = null, y = null, b = -1, E = !1, v = !1, A = !1, w = null, q = { version: "starli.conversation.view.v1", scope: n, title: "Starli", messages: [], draft: "", status: "loading", canSend: !1, canStop: !1, error: null };
  const z = () => {
    const P = a();
    return !h.signal.aborted && P.token === c && gs(n, P.scope);
  };
  function X(P) {
    q = Object.freeze({ ...q, ...P });
    for (const tt of f) tt();
  }
  function U() {
    y = null, X({ messages: [], draft: "", status: "denied", canSend: !1, canStop: !1, error: "Your account access changed. Reopen this conversation." }), h.abort();
  }
  async function W(P, tt, O = {}) {
    if (!z())
      throw U(), Error("Conversation changed");
    const I = await u(P, { method: tt === void 0 ? "GET" : "POST", signal: h.signal, credentials: "same-origin", cache: "no-store", redirect: "error", headers: { Authorization: "Bearer " + c, Accept: "application/json", ...tt === void 0 ? {} : { "Content-Type": "application/json" }, ...O }, ...tt === void 0 ? {} : { body: JSON.stringify(tt) } });
    if (!z())
      throw await I.body?.cancel().catch(() => {
      }), U(), Error("Conversation changed");
    if ([401, 403, 404].includes(I.status))
      throw U(), Error("Access changed");
    if (!I.ok) throw Error("Request not confirmed");
    return I;
  }
  async function it(P, tt) {
    const O = await W(P, tt);
    if (!O.headers.get("content-type")?.includes("application/json")) throw Error("Invalid response");
    const I = await O.json();
    if (!z())
      throw U(), Error("Conversation changed");
    return I;
  }
  function H(P) {
    if (!P || typeof P.messages != "object") throw Error("History unavailable");
    const tt = /* @__PURE__ */ new Set(), O = [];
    let I = P.currentId ?? null;
    for (; I !== null; ) {
      if (!Aa(I) || tt.has(I) || tt.size >= 1e4) throw Error("History ancestry invalid");
      const et = P.messages[I];
      if (!et || et.id !== I) throw Error("History ancestry invalid");
      tt.add(I), ["user", "assistant", "system"].includes(et.role) && O.unshift(et), I = et.parentId ?? null;
    }
    return O;
  }
  function J(P) {
    if (P.id !== d || P.user_id !== n.ownerId) throw Error("Owned conversation unavailable");
    const tt = H(P.chat?.history);
    m = P;
    const O = tt.at(-1), I = O?.starliPublicRun;
    y = null, I?.version === "starli.run.v1" && I.conversationId === d && I.assistantMessageId === O.id && Aa(I.runId) && Aa(I.requestId) && (y = { runId: I.runId, requestId: I.requestId, conversationId: d, assistantMessageId: O.id }, b = I.lastSeq ?? -1);
    const et = O?.role === "assistant" && (y ? !Um.has(I.status) : O.done === !1);
    X({ title: p?.name || P.chat.title || "Starli", messages: tt.filter((ht) => ht.role !== "system").map((ht) => ({ id: ht.id, role: ht.role, content: typeof ht.content == "string" ? ht.content : "", ...ht.role === "assistant" ? { name: p?.name || "Starli", tools: q.messages.find((T) => T.id === ht.id)?.tools } : {} })), status: et ? "streaming" : "ready", canSend: !et, canStop: et && !!y, error: w });
  }
  async function ct() {
    if (!n.agentId) return;
    if (p = await it("/api/v1/starli/v3-native/agents/" + encodeURIComponent(n.agentId)), p.id !== n.agentId) throw Error("Agent scope invalid");
    const P = await it("/api/v1/starli/v3-native/agents/" + encodeURIComponent(n.agentId) + "/conversation");
    if (P.agentId !== n.agentId || P.chatId !== null && !Aa(P.chatId))
      throw U(), Error("Agent conversation invalid");
    if (d && P.chatId !== d)
      throw U(), Error("Agent conversation changed");
    !d && P.chatId && (d = P.chatId, r?.(d));
  }
  async function Ct() {
    if (!(E || v || h.signal.aborted)) {
      v = !0;
      try {
        await ct(), d ? J(await it("/api/v1/chats/" + encodeURIComponent(d))) : X({ title: p?.name || "Starli", messages: [], status: "ready", canSend: !!p, canStop: !1, error: w });
      } catch {
        z() && X({ status: "disconnected", canSend: !1, error: "Conversation could not be refreshed. Your draft was kept." });
      } finally {
        v = !1;
      }
    }
  }
  async function B(P) {
    if (d) return;
    if (A) throw Error("Check conversation before creating again");
    A = !0;
    const tt = await it("/api/v1/chats/new", { chat: { id: crypto.randomUUID(), title: p?.name || "Starli", models: [P], system: [p?.instructions, p?.role].filter(Boolean).join(`

`), params: {}, history: { messages: {}, currentId: null }, messages: [], tags: [], timestamp: Date.now() } });
    if (!Aa(tt.id) || tt.user_id !== n.ownerId) throw Error("New chat unconfirmed");
    if (d = tt.id, n.agentId) {
      const O = await u("/api/v1/starli/v3-native/agents/" + encodeURIComponent(n.agentId) + "/conversation", { method: "PUT", signal: h.signal, credentials: "same-origin", headers: { Authorization: "Bearer " + c, "Content-Type": "application/json" }, body: JSON.stringify({ chatId: d }) });
      if (!z() || !O.ok || !O.headers.get("content-type")?.includes("application/json")) throw Error("Agent binding unconfirmed");
      const I = await O.json();
      if (!z() || I.agentId !== n.agentId || I.chatId !== d) throw Error("Agent binding unconfirmed");
      await ct();
    }
    m = tt, r?.(d);
  }
  async function F() {
    if (E || !q.canSend || !q.draft.trim() || !z()) return;
    E = !0, w = null;
    const P = q.draft;
    X({ status: "sending", canSend: !1, error: null });
    let tt = !1;
    try {
      if (await ct(), d) {
        const bt = await it("/api/v1/chats/" + encodeURIComponent(d));
        if (J(bt), !q.canSend) throw Error("Previous turn active");
        X({ status: "sending", canSend: !1 });
      }
      const O = m?.chat?.models;
      let I = Array.isArray(O) && O.length === 1 ? O[0] : null;
      if (!I) {
        const bt = await it("/api/v1/starli/runs/capabilities");
        if (typeof bt.chatModelId != "string") throw Error("Native model unavailable");
        I = bt.chatModelId;
      }
      const et = await uA(c, I, z, u);
      if (!et) throw Error("Native runtime unavailable");
      if (await B(I), !d) throw Error("Chat unavailable");
      const ht = m.chat.history.currentId ?? null, T = crypto.randomUUID(), _ = crypto.randomUUID(), Y = await dA(c, d, { turnId: crypto.randomUUID(), expectedCurrentId: ht, userMessageId: T, assistantMessageId: _, model: I, userMessage: { content: P } }, et, z, u);
      if (!z()) throw Error("Context changed");
      tt = !0;
      const x = H(m.chat.history).map((bt) => ({ role: bt.role, content: bt.content }));
      m.chat.system && !x.some((bt) => bt.role === "system") && x.unshift({ role: "system", content: m.chat.system }), x.push({ role: "user", content: P });
      const $ = rA({ stream: !0, model: I, messages: x, params: m.chat.params || {}, chat_id: d, id: _ }, Y.capability), ot = await W("/api/chat/completions", $.body, $.headers);
      if (y = oA(ot, $.scope), b = -1, X({ draft: q.draft === P ? "" : q.draft, status: "streaming", canSend: !1, canStop: !0, messages: [...q.messages, { id: T, role: "user", content: P }, { id: _, role: "assistant", name: p?.name || "Starli", content: "" }] }), !ot.headers.get("content-type")?.includes("text/event-stream") || !ot.body) throw Error("Stream unavailable");
      const ut = ot.body.getReader(), xt = new TextDecoder();
      let wt = "";
      try {
        for (; z(); ) {
          const bt = await ut.read();
          if (bt.done) break;
          if (wt = (wt + xt.decode(bt.value, { stream: !0 })).replace(/\r\n/g, `
`), wt.length > 262144) throw Error("Stream bound exceeded");
          let be;
          for (; (be = wt.indexOf(`

`)) >= 0; ) {
            const un = wt.slice(0, be);
            wt = wt.slice(be + 2);
            const rn = un.split(`
`).filter((Pt) => Pt.startsWith("data:")).map((Pt) => Pt.slice(5).trimStart()).join(`
`);
            if (!rn || rn === "[DONE]") continue;
            let pn;
            try {
              pn = JSON.parse(rn);
            } catch {
              continue;
            }
            if (!z()) break;
            const Wt = y ? cA(pn, y) : null;
            Wt && Wt.seq > b && (b = Wt.seq, Wt.type === "tool.lifecycle" && X({ messages: q.messages.map((Pt) => Pt.id === _ ? { ...Pt, tools: [...(Pt.tools || []).filter((Ml) => Ml.id !== Wt.toolCallId), { id: Wt.toolCallId, name: Wt.publicToolName, status: Wt.status }].slice(-64) } : Pt) }), Wt.type === "run.state" && Um.has(Wt.status) && X({ status: "ready", canStop: !1 }));
            const Un = pn.choices?.[0]?.delta?.content;
            if (typeof Un == "string" && X({ messages: q.messages.map((Pt) => Pt.id === _ ? { ...Pt, content: Pt.content + Un } : Pt) }), pn.error) throw Error("Completion error");
          }
        }
      } finally {
        await ut.cancel().catch(() => {
        }), ut.releaseLock();
      }
    } catch (O) {
      z() && (w = tt ? "Turn delivery is unconfirmed. Refresh before sending again." : hA(O) || "Could not send. Your draft was kept; refresh before retrying.", X({ status: "disconnected", canSend: !1, error: w }));
    } finally {
      E = !1, z() && await Ct();
    }
  }
  async function nt() {
    if (!y || !q.canStop || !z()) return;
    const P = y;
    X({ status: "stopping" });
    try {
      const tt = await it("/api/v1/starli/runs/" + encodeURIComponent(P.runId) + "/cancel", {});
      if (tt.run?.runId !== P.runId || tt.run?.conversationId !== d || tt.run?.assistantMessageId !== P.assistantMessageId) throw Error("Stop scope invalid");
    } catch {
      throw z() && X({ status: "disconnected", error: "Stop could not be confirmed. The run may still be active." }), Error("Stop unconfirmed");
    }
  }
  const Et = setInterval(() => {
    z() ? E || Ct() : U();
  }, 3e3);
  return Ct(), { getSnapshot: () => q, subscribe(P) {
    return f.add(P), () => {
      f.delete(P);
    };
  }, setDraft(P) {
    z() ? X({ draft: P }) : U();
  }, send: F, stop: nt, refresh: Ct, detach() {
    h.abort(), clearInterval(Et), f.clear();
  } };
}
function gA(n, a, u, r) {
  return iA(n, a, (c) => pA(c, u, fetch, r), () => u().scope);
}
export {
  pA as createPersonalController,
  iA as mountConversation,
  gA as mountPersonalConversation
};
