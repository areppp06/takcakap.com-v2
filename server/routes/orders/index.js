/**
 * Orders domain mount entry — keeps server/index.js thin.
 */
'use strict';

module.exports = function registerOrdersRoutes(app) {
    require('./adminList')(app);
    require('./adminStream')(app);
    require('./userList')(app);
    require('./create')(app);
    require('./reorder')(app);
    require('./receipt')(app);
    require('./adminActions')(app);
};
