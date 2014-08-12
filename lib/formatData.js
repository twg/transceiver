module.exports = function formatData(modelName, data) {
  return {
    "model": modelName,
    "id": data.id,
    "data": data
  };
};