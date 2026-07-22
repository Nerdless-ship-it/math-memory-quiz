export const POWER_PAIRS = Object.freeze([
  ...[
    [11, 121], [12, 144], [13, 169], [14, 196], [15, 225], [16, 256],
    [17, 289], [18, 324], [19, 361], [21, 441], [22, 484], [23, 529],
    [24, 576], [25, 625], [26, 676], [27, 729], [28, 784], [29, 841]
  ].map(([base, result]) => ({
    id: `square-${base}`,
    base: String(base),
    exponent: 2,
    result: String(result),
    acceptedResults: [String(result)],
    topic: '平方数',
    approximate: false
  })),
  {
    id: 'cube-1.2', base: '1.2', exponent: 3, result: '1.7',
    acceptedResults: ['1.7', '1.728'], topic: '立方数', approximate: true
  },
  {
    id: 'cube-1.3', base: '1.3', exponent: 3, result: '2.2',
    acceptedResults: ['2.2', '2.197'], topic: '立方数', approximate: true
  },
  {
    id: 'cube-1.4', base: '1.4', exponent: 3, result: '2.7',
    acceptedResults: ['2.7', '2.744'], topic: '立方数', approximate: true
  },
  {
    id: 'fourth-1.2', base: '1.2', exponent: 4, result: '2',
    acceptedResults: ['2', '2.0736'], topic: '四次幂', approximate: true
  },
  {
    id: 'fourth-1.3', base: '1.3', exponent: 4, result: '2.9',
    acceptedResults: ['2.9', '2.8561'], topic: '四次幂', approximate: true
  },
  {
    id: 'fourth-1.4', base: '1.4', exponent: 4, result: '3.8',
    acceptedResults: ['3.8', '3.8416'], topic: '四次幂', approximate: true
  }
]);
