// ============================================================
// 필요할 때만 여는 공통 기능 설명 팝업
// ============================================================
(function () {
    "use strict";

    var modal = null;
    var title = null;
    var body = null;
    var lastTrigger = null;

    function $(id) { return document.getElementById(id); }

    function closeHelp() {
        if (!modal || modal.hidden) return;
        modal.hidden = true;
        document.body.classList.remove("help-open");
        if (lastTrigger && lastTrigger.focus) lastTrigger.focus();
    }

    function openHelp(button) {
        var source = $(button.getAttribute("data-help"));
        if (!modal || !source) return;
        lastTrigger = button;
        title.textContent = button.getAttribute("data-help-title") || "기능 설명";
        body.innerHTML = source.innerHTML;
        modal.hidden = false;
        document.body.classList.add("help-open");
        $("help-modal-close").focus();
    }

    function init() {
        modal = $("help-modal");
        title = $("help-modal-title");
        body = $("help-modal-body");
        if (!modal || !title || !body) return;

        var buttons = document.querySelectorAll(".help-btn");
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].addEventListener("click", function () { openHelp(this); });
        }

        $("help-modal-close").addEventListener("click", closeHelp);
        $("help-modal-confirm").addEventListener("click", closeHelp);
        modal.addEventListener("click", function (event) {
            if (event.target === modal) closeHelp();
        });
        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") closeHelp();
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
