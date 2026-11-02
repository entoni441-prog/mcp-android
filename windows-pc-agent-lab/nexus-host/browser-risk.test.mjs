// 0.5.1 D2/D3 — browser risk boundary (pure, no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyBrowserRisk as k} from './browser.mjs';

const what = f => k(f)?.what ?? 'auto';

test('D2: preparing a purchase is autonomous', () => {
  for (const label of ['Search', 'Add to cart', 'Aggiungi al carrello', 'В корзину', 'Proceed to checkout', 'Checkout', 'Перейти к оформлению',
    'Procedi all\'ordine', 'Compare', 'Next page', 'Remove from cart', 'Удалить из корзины', 'Apply coupon', 'Continue to shipping'])
    assert.equal(what({label}), 'auto', label);
  // ordinary navigation steps inside checkout stay autonomous
  for (const label of ['Continue to shipping', 'Apply', 'Back', 'Изменить', 'Proceed to checkout'])
    assert.equal(what({label, submit: true, checkout: 'url'}), 'auto', label);
});

test('D2: the step that creates a paid obligation needs consent — by label', () => {
  for (const label of ['Place your order', 'Buy now', 'Pay', 'Pay later', 'Pay in 3', 'PayPal', 'Complete purchase', 'Confirm order',
    'Subscribe', 'Start free trial', 'Book now', 'Order', 'Купить', 'Оплатить', 'Оплатить позже', 'Заказать', 'Оформить заказ',
    'Разместить заказ', 'Подписаться', 'Перевести', 'Acquista ora', 'Paga', 'Invia ordine', 'Conferma ordine', 'Abbonati', 'Prenota'])
    assert.deepEqual(k({label}), {what: 'browser_financial', reason: 'commitment_label'}, label);
});

test('D2: decided by result/context, not text — unknown submit on a checkout page needs consent', () => {
  for (const checkout of ['url', 'card_fields', 'payment_frame'])
    for (const label of ['Continue', 'Далее', 'Fertig', '', 'OK'])
      assert.equal(k({label, submit: true, checkout})?.what, 'browser_financial', `${checkout}/${label}`);
  // the same labels off-checkout, or not submitting a form, are ordinary
  assert.equal(what({label: 'Continue', submit: true, checkout: null}), 'auto');
  assert.equal(what({label: 'Details', submit: false, checkout: 'url'}), 'auto');
});

test('D3: outgoing / destructive actions on the owner\'s behalf need consent; generic confirm does not', () => {
  for (const label of ['Send', 'Post', 'Publish', 'Delete', 'Sign up', 'Register', 'Submit', 'Отправить', 'Опубликовать', 'Удалить', 'Invia', 'Elimina'])
    assert.equal(what({label}), 'browser_irreversible', label);
  for (const label of ['Confirm', 'Подтвердить', 'Sort by price', 'Postcode lookup'])
    assert.equal(what({label}), 'auto', label);
});
