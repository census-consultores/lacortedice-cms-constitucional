export default {
  rest: {
    defaultLimit: 25,
    maxLimit: 100, // Máximo por request — protege contra queries masivas
    withCount: true,
  },
};
