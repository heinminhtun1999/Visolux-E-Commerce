function canAccessOrder(session, order) {
  if (!order) return false;
  if (session?.user && order.user_id && session.user.user_id === order.user_id) return true;
  if (!order.user_id && session?.lastGuestOrderId && Number(session.lastGuestOrderId) === order.order_id) return true;
  return false;
}

module.exports = { canAccessOrder };
