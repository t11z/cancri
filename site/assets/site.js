/* cancri docs — small behaviours. Honours prefers-reduced-motion: information
   parity is preserved, the flourishes are dropped. */
(function () {
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── live ET clock in the header (the terminal is always honest about time) ── */
  function tickClock() {
    var el = document.querySelector("[data-clock]");
    if (!el) return;
    try {
      var t = new Date().toLocaleTimeString("en-US", {
        timeZone: "America/New_York", hour12: false,
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
      el.textContent = t + " ET";
    } catch (e) {
      el.textContent = "--:--:-- ET";
    }
  }
  tickClock();
  setInterval(tickClock, 1000);

  /* ── boot sequence: stagger the lines in, then settle the caret ── */
  var boot = document.querySelector("[data-boot]");
  if (boot) {
    var lines = Array.prototype.slice.call(boot.querySelectorAll(".ln"));
    var caretLine = boot.querySelector(".caret-line");
    if (reduce) {
      lines.forEach(function (l) { l.style.opacity = "1"; });
      if (caretLine) caretLine.style.opacity = "1";
    } else {
      lines.forEach(function (l) { l.style.opacity = "0"; });
      if (caretLine) caretLine.style.opacity = "0";
      lines.forEach(function (l, i) {
        setTimeout(function () { l.style.opacity = ""; l.style.animation = "bootline .35s ease both"; }, i * 300);
      });
      if (caretLine) setTimeout(function () { caretLine.style.opacity = "1"; }, lines.length * 300 + 200);
    }
  }

  /* ── copy buttons on code blocks ── */
  document.querySelectorAll(".code .copy").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var pre = btn.closest(".code").querySelector("pre");
      if (!pre) return;
      var text = pre.innerText;
      var done = function () {
        var prev = btn.textContent;
        btn.textContent = "copied ✓"; btn.classList.add("done");
        setTimeout(function () { btn.textContent = prev; btn.classList.remove("done"); }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = document.createElement("textarea");
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); } catch (e) {}
        document.body.removeChild(ta); done();
      }
    });
  });

  /* ── mobile nav toggle ── */
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.querySelector(".nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () { nav.classList.toggle("open"); });
  }

  /* ── active section tracking for the table of contents ── */
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll(".toc a[href^='#']"));
  if (tocLinks.length && "IntersectionObserver" in window) {
    var byId = {};
    tocLinks.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          tocLinks.forEach(function (a) { a.classList.remove("active"); });
          var a = byId[en.target.id];
          if (a) a.classList.add("active");
        }
      });
    }, { rootMargin: "-80px 0px -70% 0px", threshold: 0 });
    Object.keys(byId).forEach(function (id) {
      var sec = document.getElementById(id);
      if (sec) io.observe(sec);
    });
  }
})();
