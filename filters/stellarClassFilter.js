// filters/stellarClassFilter.js

/**
 * Applies stellar class logic and determines visibility and display names.
 */
export function applyStellarClassLogic(stars, form) {
  const stellarClassShowName = {};
  const stellarClassShowStar = {};
  const classNameCheckboxes = form.querySelectorAll('input[name="stellar-class-show-name"]');
  classNameCheckboxes.forEach(chk => stellarClassShowName[chk.value] = chk.checked);
  const classStarCheckboxes = form.querySelectorAll('input[name="stellar-class-show-star"]');
  classStarCheckboxes.forEach(chk => stellarClassShowStar[chk.value] = chk.checked);

  const individualShowName = {};
  const individualShowStar = {};
  const starNameCheckboxes = form.querySelectorAll('input[name="star-show-name"]');
  starNameCheckboxes.forEach(chk => individualShowName[chk.value] = chk.checked);
  const starStarCheckboxes = form.querySelectorAll('input[name="star-show-star"]');
  starStarCheckboxes.forEach(chk => individualShowStar[chk.value] = chk.checked);

  stars.forEach(star => {
    const primaryClass = (star.Stellar_class && typeof star.Stellar_class === 'string')
      ? star.Stellar_class.charAt(0).toUpperCase() : 'G';
    const starName = star.Common_name_of_the_star || '';
    const starSystemName = star.Common_name_of_the_star_system || '';
    const classShowStar = stellarClassShowStar[primaryClass] !== undefined ? stellarClassShowStar[primaryClass] : true;
    const starShowStar = individualShowStar[starName] !== undefined ? individualShowStar[starName] : true;
    star.displayVisible = classShowStar && starShowStar;
    if (!star.displayVisible) {
      star.displayName = '';
      return;
    }
    const classShowName = stellarClassShowName[primaryClass] !== undefined ? stellarClassShowName[primaryClass] : true;
    const starShowName = individualShowName[starName] !== undefined ? individualShowName[starName] : true;
    if (classShowName && starShowName) {
      if (starName && starSystemName) {
        star.displayName = starName === starSystemName ? starName : `${starName} (${starSystemName})`;
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
 * Dynamically generates stellar class subcategories.
 */
export function generateStellarClassFilters(stars) {
  const container = document.getElementById('stellar-class-container');
  container.innerHTML = '';
  container.classList.add('scrollable-category');

  const classMap = {};
  stars.forEach(star => {
    const primaryClass = (star.Stellar_class && typeof star.Stellar_class === 'string')
      ? star.Stellar_class.charAt(0).toUpperCase() : 'G';
    if (!classMap[primaryClass]) classMap[primaryClass] = [];
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

    const subcatDiv = document.createElement('div');
    subcatDiv.classList.add('collapsible-subcategory');

    const header = document.createElement('div');
    header.classList.add('subcategory-header', 'collapsible');
    header.textContent = `${cls} (${cName}) - ${starCount}`;
    subcatDiv.appendChild(header);

    const contentDiv = document.createElement('div');
    contentDiv.classList.add('subcategory-content');
    subcatDiv.appendChild(contentDiv);

    arr.forEach(star => {
      let formattedName = star.Common_name_of_the_star;
      if (star.Common_name_of_the_star && star.Common_name_of_the_star_system && star.Common_name_of_the_star !== star.Common_name_of_the_star_system) {
        formattedName = /^[A-Za-z]$/.test(star.Common_name_of_the_star.trim())
          ? `${star.Common_name_of_the_star_system} (${star.Common_name_of_the_star})`
          : `${star.Common_name_of_the_star} (${star.Common_name_of_the_star_system})`;
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

    header.addEventListener('click', () => {
      header.classList.toggle('active');
      contentDiv.classList.toggle('open');
    });

    container.appendChild(subcatDiv);
  });

  function sanitizeName(name) {
    return (name || '').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-]/g, '');
  }
}
