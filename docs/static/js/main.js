(function ($) {
    'use strict';
    $(function () {
        $('[data-toggle="tooltip"]').tooltip();
        $('[data-toggle="popover"]').popover();
        $('.popover-dismiss').popover({
            trigger: 'focus'
        })
    });

    function bottomPos(element) {
        return element.offset().top + element.outerHeight();
    }
    $(function () {
        var promo = $(".js-td-cover");
        if (!promo.length) {
            return
        }
        var promoOffset = bottomPos(promo);
        var navbarOffset = $('.js-navbar-scroll').offset().top;
        var threshold = Math.ceil($('.js-navbar-scroll').outerHeight());
        if ((promoOffset - navbarOffset) < threshold) {
            $('.js-navbar-scroll').addClass('navbar-bg-onscroll');
        }
        $(window).on('scroll', function () {
            var navtop = $('.js-navbar-scroll').offset().top - $(window).scrollTop();
            var promoOffset = bottomPos($('.js-td-cover'));
            var navbarOffset = $('.js-navbar-scroll').offset().top;
            if ((promoOffset - navbarOffset) < threshold) {
                $('.js-navbar-scroll').addClass('navbar-bg-onscroll');
            } else {
                $('.js-navbar-scroll').removeClass('navbar-bg-onscroll');
                $('.js-navbar-scroll').addClass('navbar-bg-onscroll--fade');
            }
        });
    });
}(jQuery));


/*popup-hidden-div*/

function HideToggleFunction() {
    var hide = document.getElementById("hiddendiv");
    
    if (hide) {
        if (hide.style.display === "block") {
            hide.style.display = "none";
        } else {
            hide.style.display = "block";
        }
    }
}

/*clipboard*/

var getcodeelement = $('.clipboardjs');

getcodeelement.each(function () {
    
    /*trigger*/
    
    var clipButton = '<div class="btn-copy-wrap"><button type="button" class="clipbtn" aria-label="Copy code to clipboard"><i class="far fa-copy" aria-hidden="true"></i></button></div>';
    $(this).after(clipButton);
});

var clipboard = new Clipboard('.clipbtn', {
    text: function (trigger) {
        var container = trigger.closest('pre') || trigger.closest('.highlight');
        var content = container ? container.querySelector('.clipboardjs') : null;
        var text = content ? content.textContent : '';
        return text.trim().replace(/^\s*\$\s+/gm, '');
    }
});

/* Change copy icon to check icon when successfully copied*/
clipboard.on("success", (e) => {
    const button = e.trigger;
    if (button.dataset.isCopying === "true") {
        return;
    }

    const icon = button.querySelector('i');
    if (!icon) return;

    button.dataset.isCopying = "true";
    button.setAttribute('aria-label', 'Copied to clipboard');

    const originalIcon = icon.cloneNode(true);
    const text = document.createElement('span');
    const checkIcon = document.createElement('i');
    checkIcon.className = 'fas fa-check';
    checkIcon.style.color = "var(--brand-color-secondary)";
    checkIcon.setAttribute('aria-hidden', 'true');
    text.appendChild(checkIcon);
    text.appendChild(document.createTextNode(' Copied!'));
    text.style.color = "var(--brand-color-secondary)";

    button.replaceChild(text, icon);

    setTimeout(() => {
        // 1. Always reset accessible name/state first (safe even if detached)
        button.setAttribute('aria-label', 'Copy code to clipboard');
        button.removeAttribute("data-is-copying");
        // 2. Guard only the physical DOM manipulation
        if (button.isConnected === false) {
            return;
        }
        if (text.parentNode === button) {
            button.replaceChild(originalIcon, text);
        }
    }, 2000);
});
const toggleBtnSidebarNav = document.querySelector(".nav-toggle-btn--document");

if (toggleBtnSidebarNav) {
    toggleBtnSidebarNav.addEventListener("click", () => {
        const leftContainer = document.querySelector(".left-container");

        if (leftContainer) {
            const isActive = leftContainer.classList.toggle('left-container--active');

            const newState = isActive ? 'active' : 'inactive';
            localStorage.setItem('leftContainer-state', newState);
        }
    })
}

const toggleBtnMainNav = document.querySelector(".nav-toggle-btn--main");

if (toggleBtnMainNav) {
    toggleBtnMainNav.addEventListener("click", () => {
        let sidebarNav = document.getElementById("main_navbar")
        if (sidebarNav) {
            sidebarNav.classList.toggle("main-navbar--active")
        }      
    })
}

document.addEventListener("click", (event) => {
    let sidebarNav = document.getElementById("main_navbar")
    if (sidebarNav) {
        let isClickInsideSidebar = sidebarNav.contains(event.target)
        let isClickOnToggleButton = toggleBtnMainNav && toggleBtnMainNav.contains(event.target)

        if (!isClickInsideSidebar && !isClickOnToggleButton) {
            sidebarNav.classList.remove("main-navbar--active")
        }
    }
});

/*table of contents scrollspy*/

(function () {
    const tocLinks = document.querySelectorAll('#TableOfContents a[href^="#"]');
    if (!tocLinks.length || !("IntersectionObserver" in window)) return;

    const tocWrapper = document.querySelector(".content-table-wrapper");
    const sections = [];

    tocLinks.forEach((link) => {
        let id = link.getAttribute("href").slice(1);
        try {
            id = decodeURIComponent(id);
        } catch (e) {
            // keep the raw fragment if it is not valid percent-encoding
        }
        const heading = document.getElementById(id);
        if (heading) {
            sections.push({ heading, link });
        }
    });
    if (!sections.length) return;

    let activeLink = null;

    function keepLinkVisible(link) {
        if (!tocWrapper) return;
        const linkRect = link.getBoundingClientRect();
        const wrapperRect = tocWrapper.getBoundingClientRect();
        if (linkRect.top >= wrapperRect.top && linkRect.bottom <= wrapperRect.bottom) return;

        // Scroll only the TOC container; scrollIntoView would also move the page.
        tocWrapper.scrollTo({
            top: tocWrapper.scrollTop + linkRect.top - wrapperRect.top - (wrapperRect.height - linkRect.height) / 2,
            behavior: "smooth"
        });
    }

    function updateActiveLink() {
        // A section becomes active once its heading passes the top 30% of the viewport.
        const activationLine = window.innerHeight * 0.3;
        let current = null;

        sections.forEach((section) => {
            // Skip headings that are not rendered, e.g. inside a hidden tab.
            if (!section.heading.getClientRects().length) return;
            if (section.heading.getBoundingClientRect().top <= activationLine) {
                current = section;
            }
        });

        const link = current ? current.link : null;
        if (link === activeLink) return;

        if (activeLink) activeLink.classList.remove("active");
        activeLink = link;
        if (link) {
            link.classList.add("active");
            keepLinkVisible(link);
        }
    }

    // The callback fires whenever a heading crosses the activation line.
    const observer = new IntersectionObserver(updateActiveLink, {
        rootMargin: "0px 0px -70% 0px"
    });
    sections.forEach((section) => observer.observe(section.heading));
})();

