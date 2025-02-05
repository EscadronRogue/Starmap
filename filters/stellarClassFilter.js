// filters/stellarClassFilter.js

/**
 * Handles "Stellar Class" logic for showing/hiding star names and star objects.
 * Also exports `generateStellarClassFilters` to build the UI subcategories.
 */
export function applyStellarClassLogic(stars, form) {
  // Get class-level checkboxes for showing/hiding names and stars
  const stellarClassShowName = {};
  const stellarClassShowStar = {};
  const classNameCheckboxes = form.querySelectorAll('input[name="stellar-class-show-name"]');
  classNameCheckboxes.forEach(checkbox => {
    stellarClassShowName[checkbox.value] = checkbox.checked;
  });
  const classStarCheckboxes = form.querySelectorAll('input[name="stellar-class-show-star"]');
  classStarCheckboxes.forEach(checkbox => {
    stellarClassShowStar[checkbox.value] = checkbox.checked;
  });
  
  // Get individual star-level settings
  const individualShowName = {};
  const individualShowStar = {};
  const starNameCheckboxes = form.querySelectorAll('input[name="star-show-name"]');
  starNameCheckboxes.forEach(chk => {
    individualShowName[chk.value] = chk.checked;
  });
  const starStarCheckboxes = form.querySelectorAll('input[name="star-show-star"]');
  starStarCheckboxes.forEach(chk => {
    individualShowStar[chk.value] = chk.checked;
  });
  
  stars.forEach(star => {
    const primaryClass = (star.Stellar_class && typeof star.Stellar_class === 'string')
      ? star.Stellar_class.charAt(0).toUpperCase()
      : 'G';
    const starName = star.Common_name_of_the_star || '';
    const starSystemName = star.Common_name_of_the_star_system || '';
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
        } else if (/^[A-Za-z]$/.test(starName.trim())) {
          star.displayName = `${starSystemName} (${starName})`;
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
  return stars.filter(st => st.displayVisible);
}

/**
 * Builds UI for the stellar class subcategories.
 * Each subcategory is collapsible and its content is styled consistently.
 */
export function generateStellarClassFilters(stars) {
  const container = document.getElementById('stellar-class-container');
  container.innerHTML = ''; // Clear previous content
  container.classList.add('scrollable-category');

  // Group stars by stellar class
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

    // Create subcategory container
    const subcatDiv = document.createElement('div');
    subcatDiv.classList.add('collapsible-subcategory');

    // Create header for subcategory
    const header = document.createElement('div');
    header.classList.add('subcategory-header');
    header.textContent = `${cls} (${cName}) - ${starCount}`;
    subcatDiv.appendChild(header);

    // Create content container (initially collapsed)
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('subcategory-content');
    subcatDiv.appendChild(contentDiv);

    // Populate with individual star checkboxes
    arr.forEach(star => {
      let formattedName = star.Common_name_of_the_star;
      if (
        star.Common_name_of_the_star &&
        star.Common_name_of_the_star_system &&
        star.Common_name_of_the_star !== star.Common_name_of_the_star_system
      ) {
        if (/^[A-Za-z]$/.test(star.Common_name_of_the_star.trim())) {
          formattedName = `${star.Common_name_of_the_star_system} (${star.Common_name_of_the_star})`;
        } else {
          formattedName = `${star.Common_name_of_the_star} (${star.Common_name_of_the_star_system})`;
        }
      }
      const containerDiv = document.createElement('div');
      containerDiv.classList.add('filter-item');
      const nameCheckbox = document.createElement('input');
      nameCheckbox.type = 'checkbox';
      nameCheckbox.id = `star-${sanitizeName(star.Common_name_of_the_star)}-name`;
      nameCheckbox.name = 'star-show-name';
      nameCheckbox.value = star.Common_name_of_the_star;
      nameCheckbox.checked = true;
      const nameLabel = document.createElement('label');
      nameLabel.htmlFor = `star-${sanitizeName(star.Common_name_of_the_star)}-name`;
      nameLabel.textContent = 'Show Name';
      containerDiv.appendChild(nameCheckbox);
      containerDiv.appendChild(nameLabel);
      contentDiv.appendChild(containerDiv);
    });

    // Toggle functionality for subcategory
    header.addEventListener('click', () => {
      header.classList.toggle('active');
      if (header.classList.contains('active')) {
        contentDiv.style.maxHeight = contentDiv.scrollHeight + 'px';
      } else {
        contentDiv.style.maxHeight = '0';
      }
    });

    container.appendChild(subcatDiv);
  });

  function sanitizeName(name) {
    return (name || '').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-]/g, '');
  }
}
