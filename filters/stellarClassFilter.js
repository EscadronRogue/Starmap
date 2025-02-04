// filters/stellarClassFilter.js

/**
 * Handles "Stellar Class" logic for showing/hiding star names and star objects themselves.
 * Also exports `generateStellarClassFilters` to build the UI subcategories (O,B,A,F,G,K,M,L,T,Y).
 */

export function applyStellarClassLogic(stars, form) {
  // Collect checkboxes from the form
  const stellarClassShowName = {};
  const stellarClassShowStar = {};

  // Class-level "Show Name" / "Show Star"
  const classNameCheckboxes = form.querySelectorAll(`input[name="stellar-class-show-name"]`);
  classNameCheckboxes.forEach(checkbox => {
    stellarClassShowName[checkbox.value] = checkbox.checked;
  });

  const classStarCheckboxes = form.querySelectorAll(`input[name="stellar-class-show-star"]`);
  classStarCheckboxes.forEach(checkbox => {
    stellarClassShowStar[checkbox.value] = checkbox.checked;
  });

  // Individual star-level "Show Name" / "Show Star"
  const individualShowName = {};
  const individualShowStar = {};

  const starNameCheckboxes = form.querySelectorAll(`input[name="star-show-name"]`);
  starNameCheckboxes.forEach(chk => {
    individualShowName[chk.value] = chk.checked;
  });

  const starStarCheckboxes = form.querySelectorAll(`input[name="star-show-star"]`);
  starStarCheckboxes.forEach(chk => {
    individualShowStar[chk.value] = chk.checked;
  });

  // Apply logic to each star
  stars.forEach(star => {
    // Handle missing or empty stellar class
    const primaryClass = (star.Stellar_class && typeof star.Stellar_class === 'string')
      ? star.Stellar_class.charAt(0).toUpperCase()
      : 'G'; // fallback

    const starName = star.Common_name_of_the_star || '';
    const starSystemName = star.Common_name_of_the_star_system || '';

    // 1) Decide if star is visible
    const classShowStar = stellarClassShowStar.hasOwnProperty(primaryClass)
      ? stellarClassShowStar[primaryClass]
      : true;
    const starShowStar = individualShowStar.hasOwnProperty(starName)
      ? individualShowStar[starName]
      : true;

    star.displayVisible = classShowStar && starShowStar;

    if (!star.displayVisible) {
      star.displayName = '';
      return;
    }

    // 2) Decide if star name is displayed
    const classShowName = stellarClassShowName.hasOwnProperty(primaryClass)
      ? stellarClassShowName[primaryClass]
      : true;
    const starShowName = individualShowName.hasOwnProperty(starName)
      ? individualShowName[starName]
      : true;

    if (classShowName && starShowName) {
      if (starName && starSystemName) {
        if (starName === starSystemName) {
          star.displayName = starName;
        } else {
          star.displayName = `${starName} (${starSystemName})`;
        }
      } else if (starName) {
        star.displayName = starName;
      } else if (starSystemName) {
        star.displayName = starSystemName;
      } else {
        star.displayName = '';
      }
    } else {
      star.displayName = '';
    }
  });

  // Filter out invisible
  return stars.filter(st => st.displayVisible);
}

/**
 * Builds UI for the stellar class subcategories.
 *  - Each subcategory line has:
 *    -> A visually distinct header (subcategory title) that is clickable to expand/collapse the star list.
 *    -> The star list is wrapped in a scrollable sidebar if needed.
 */
export function generateStellarClassFilters(stars) {
  const container = document.getElementById('stellar-class-container');
  container.innerHTML = ''; // Clear previous
  // Wrap the whole category in a scrollable container (sidebar) if content exceeds a fixed height.
  container.classList.add('scrollable-category');

  // Group stars by class
  const classMap = {};
  stars.forEach(star => {
    const primaryClass = (star.Stellar_class && typeof star.Stellar_class === 'string')
      ? star.Stellar_class.charAt(0).toUpperCase()
      : 'G';
    if (!classMap[primaryClass]) {
      classMap[primaryClass] = [];
    }
    classMap[primaryClass].push(star);
  });

  // List of known classes
  const stellarClasses = [
    { class: 'O', commonName: 'Blue Giant' },
    { class: 'B', commonName: 'Blue-White Dwarf' },
    { class: 'A', commonName: 'White Dwarf' },
    { class: 'F', commonName: 'Yellow-White Dwarf' },
    { class: 'G', commonName: 'Yellow Dwarf' },
    { class: 'K', commonName: 'Orange Dwarf' },
    { class: 'M', commonName: 'Red Dwarf' },
    { class: 'L', commonName: 'Brown Dwarf' },
    { class: 'T', commonName: 'Cool Brown Dwarf' },
    { class: 'Y', commonName: 'Ultra Cool Brown Dwarf' }
  ];

  stellarClasses.forEach(clsObj => {
    const cls = clsObj.class;
    const cName = clsObj.commonName;
    const arr = classMap[cls] || [];
    const starCount = arr.length;

    // Outer container for this subcategory
    const subcatDiv = document.createElement('div');
    subcatDiv.classList.add('stellar-class-subcategory');

    // 1) The subcategory header (visually distinct)
    const header = document.createElement('h3');
    header.classList.add('collapsible-subcategory', 'subcategory-header');
    header.textContent = `${cls} (${cName}) - ${starCount}`;
    subcatDiv.appendChild(header);

    // 2) Class-level checkboxes row (always visible)
    const classCheckboxesDiv = document.createElement('div');
    classCheckboxesDiv.classList.add('class-level-checkboxes');

    // "Show Name" for the entire class
    const showNameDiv = document.createElement('div');
    showNameDiv.classList.add('filter-item');
    const showNameCheckbox = document.createElement('input');
    showNameCheckbox.type = 'checkbox';
    showNameCheckbox.id = `class-${cls}-name`;
    showNameCheckbox.name = 'stellar-class-show-name';
    showNameCheckbox.value = cls;
    showNameCheckbox.checked = true;
    const showNameLabel = document.createElement('label');
    showNameLabel.htmlFor = `class-${cls}-name`;
    showNameLabel.textContent = 'Show Name';
    showNameDiv.appendChild(showNameCheckbox);
    showNameDiv.appendChild(showNameLabel);
    classCheckboxesDiv.appendChild(showNameDiv);

    // "Show Star" for the entire class
    const showStarDiv = document.createElement('div');
    showStarDiv.classList.add('filter-item');
    const showStarCheckbox = document.createElement('input');
    showStarCheckbox.type = 'checkbox';
    showStarCheckbox.id = `class-${cls}-star`;
    showStarCheckbox.name = 'stellar-class-show-star';
    showStarCheckbox.value = cls;
    showStarCheckbox.checked = true;
    const showStarLabel = document.createElement('label');
    showStarLabel.htmlFor = `class-${cls}-star`;
    showStarLabel.textContent = 'Show Star';
    showStarDiv.appendChild(showStarCheckbox);
    showStarDiv.appendChild(showStarLabel);
    classCheckboxesDiv.appendChild(showStarDiv);

    subcatDiv.appendChild(classCheckboxesDiv);

    // 3) The star list subcontent (initially collapsed and scrollable if needed)
    const subcontentDiv = document.createElement('div');
    subcontentDiv.classList.add('filter-subcontent', 'subcategory-content');
    // Start collapsed
    subcontentDiv.style.maxHeight = '0';
    subcontentDiv.style.overflowY = 'hidden';

    const individualStarsDiv = document.createElement('div');
    individualStarsDiv.classList.add('individual-stars');

    arr.forEach(star => {
      let formattedName = star.Common_name_of_the_star;
      if (
        star.Common_name_of_the_star &&
        star.Common_name_of_the_star_system &&
        star.Common_name_of_the_star !== star.Common_name_of_the_star_system
      ) {
        formattedName = `${star.Common_name_of_the_star} (${star.Common_name_of_the_star_system})`;
      }

      const starContainer = document.createElement('div');
      starContainer.classList.add('star-container');

      const starNameLabel = document.createElement('span');
      starNameLabel.textContent = formattedName;
      starNameLabel.classList.add('star-name');
      starContainer.appendChild(starNameLabel);

      const checkboxesDiv = document.createElement('div');
      checkboxesDiv.classList.add('star-checkboxes');

      // "Show Name"
      const individualShowNameDiv = document.createElement('div');
      individualShowNameDiv.classList.add('filter-item');
      const individualShowNameCheckbox = document.createElement('input');
      individualShowNameCheckbox.type = 'checkbox';
      individualShowNameCheckbox.id = `star-${sanitizeName(star.Common_name_of_the_star)}-name`;
      individualShowNameCheckbox.name = 'star-show-name';
      individualShowNameCheckbox.value = star.Common_name_of_the_star;
      individualShowNameCheckbox.checked = true;
      const individualShowNameLabel = document.createElement('label');
      individualShowNameLabel.htmlFor = `star-${sanitizeName(star.Common_name_of_the_star)}-name`;
      individualShowNameLabel.textContent = 'Show Name';
      individualShowNameDiv.appendChild(individualShowNameCheckbox);
      individualShowNameDiv.appendChild(individualShowNameLabel);
      checkboxesDiv.appendChild(individualShowNameDiv);

      // "Show Star"
      const individualShowStarDiv = document.createElement('div');
      individualShowStarDiv.classList.add('filter-item');
      const individualShowStarCheckbox = document.createElement('input');
      individualShowStarCheckbox.type = 'checkbox';
      individualShowStarCheckbox.id = `star-${sanitizeName(star.Common_name_of_the_star)}-star`;
      individualShowStarCheckbox.name = 'star-show-star';
      individualShowStarCheckbox.value = star.Common_name_of_the_star;
      individualShowStarCheckbox.checked = true;
      const individualShowStarLabel = document.createElement('label');
      individualShowStarLabel.htmlFor = `star-${sanitizeName(star.Common_name_of_the_star)}-star`;
      individualShowStarLabel.textContent = 'Show Star';
      individualShowStarDiv.appendChild(individualShowStarCheckbox);
      individualShowStarDiv.appendChild(individualShowStarLabel);
      checkboxesDiv.appendChild(individualShowStarDiv);

      starContainer.appendChild(checkboxesDiv);
      individualStarsDiv.appendChild(starContainer);
    });

    subcontentDiv.appendChild(individualStarsDiv);
    subcatDiv.appendChild(subcontentDiv);

    // Add logic to collapse/expand the star list upon clicking the subcategory header
    header.addEventListener('click', () => {
      header.classList.toggle('active');
      const isActive = header.classList.contains('active');
      header.setAttribute('aria-expanded', isActive);

      if (isActive) {
        // Expand: if content height exceeds 300px, limit height and enable scrolling
        const contentHeight = subcontentDiv.scrollHeight;
        if (contentHeight > 300) {
          subcontentDiv.style.maxHeight = '300px';
          subcontentDiv.style.overflowY = 'auto';
        } else {
          subcontentDiv.style.maxHeight = contentHeight + 'px';
          subcontentDiv.style.overflowY = 'visible';
        }
      } else {
        // Collapse
        subcontentDiv.style.maxHeight = '0';
        subcontentDiv.style.overflowY = 'hidden';
      }
    });

    container.appendChild(subcatDiv);
  });

  function sanitizeName(name) {
    return (name || '').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-]/g, '');
  }
}
