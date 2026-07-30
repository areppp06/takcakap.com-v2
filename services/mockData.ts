import { User } from '../types';

export const currentUser: User = {
  id: '1',
  name: 'Alex Johnson',
  email: 'alex.johnson@example.com',
  phoneNumber: '+60123456789',
  avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBtxsv562ZCwLqSoijE-3Yvn-ojPi7rygQkohxfrIAog1sBocAg5GQ5ict8pjg32rjVixrdP4Kwuse-98ssjepU-rQ5h_ejMzZ7sOPI167Nm1ybVxrvGn3Xn36BL6T7iGt0a8RvAUl5tOVgc4GSUOqGrTnKYeg8uEJ1_9jw0WNpjWCnGB1vVURcPQnPRnKUTJr4xGGXbEhQKVztLR57hh7qq9ME4PAJCZ9qJ9LzMlIzEE1x5zXeBqTmpVZ9pgZHI1yPynH_3rFY13fN',
  role: 'user',
  totalOrders: 24
};

export const adminUser: User = {
  id: '2',
  name: 'Alex Morgan',
  email: 'admin@takcakap.com',
  avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAKpC7vs2xAM5Zw29WJEzZ492BmWZqMWGR9lsPFGE90sb8yozgnnjkOqhXgiok9LJVjmQA8nosTzSqCAyN0s0AFcU94Lfj2BH2-dfC752oZetXHST8NHrxAUGbf4yTybSpWxmW0HZmzgRoa9jx6DNU_If9fjPA88OVa9TXwhNKSzSEtKuU3-stuP6JV29jU12qwJZQLoGJtx7qi-iAI8hyFEA9-xvbl9OSQgZDOMqHTyoIMIv-EGv5QXsQoEpni57BQifmjAruySLku',
  role: 'admin'
};
