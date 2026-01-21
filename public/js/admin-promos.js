(function () {
  function byId(id) {
    return document.getElementById(id);
  }

  function setType(type) {
    var percent = byId('promoPercentOff');
    var amount = byId('promoAmountOffRm');

    if (!percent || !amount) return;

    if (type === 'FIXED') {
      percent.value = '';
      percent.disabled = true;
      percent.required = false;

      amount.disabled = false;
      amount.required = true;
      amount.placeholder = 'e.g. 10.00';
    } else {
      amount.value = '';
      amount.disabled = true;
      amount.required = false;

      percent.disabled = false;
      percent.required = true;
      percent.placeholder = 'e.g. 10';
    }
  }

  function setTypeForRow(typeSelect) {
    if (!typeSelect) return;
    var row = typeSelect.closest('tr') || typeSelect.parentElement;
    if (!row) return;
    var percent = row.querySelector('input[data-promo-percent]');
    var amount = row.querySelector('input[data-promo-amount]');
    if (!percent || !amount) return;

    if (typeSelect.value === 'FIXED') {
      percent.value = '';
      percent.disabled = true;
      percent.required = false;

      amount.disabled = false;
      amount.required = true;
    } else {
      amount.value = '';
      amount.disabled = true;
      amount.required = false;

      percent.disabled = false;
      percent.required = true;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var type = byId('promoDiscountType');
    if (!type) return;

    setType(type.value);
    type.addEventListener('change', function () {
      setType(type.value);
    });

    var rowTypes = document.querySelectorAll('select[data-promo-type]');
    rowTypes.forEach(function (sel) {
      setTypeForRow(sel);
      sel.addEventListener('change', function () {
        setTypeForRow(sel);
      });
    });
  });
})();
