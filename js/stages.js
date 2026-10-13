/* Сроки этапов «Сейчас в работе». Впишите дату, например: '2027 · II квартал'.
   Пустая строка = «Сроки уточняются». Номер = номер карточки. */
window.JC_STAGES = {
  '01': '', // Космический ракетный комплекс
  '02': '', // Жидкостной ракетный двигатель
  '03': '', // Производственно-испытательные мощности
  '04': '', // Эскизный проект
  '05': '', // Следующие этапы
};
document.addEventListener('DOMContentLoaded', function () {
  var d = window.JC_STAGES || {};
  document.querySelectorAll('.card__date').forEach(function (el) {
    var v = d[el.dataset.stage]; if (v) { el.querySelector('em').textContent = v; el.classList.add('is-set'); }
  });
});
