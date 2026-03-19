import type { CurrencyInfo } from './types';

export const BRANCHES = ['HQ', 'BK', 'BT', 'PK', 'PJ', 'KK', 'KM', 'QSM', 'USJ', 'DPC', 'OTG'] as const;

export const CATEGORIES = [
  'Advertisement', 'Design Service', 'Equipment', 'Event', 'HR', 'Maintenance',
  'Marketing', 'Operation', 'Others', 'Purchasing', 'Recruitment', 'Renovation',
  'Sanitary', 'Service', 'Shipping', 'Staff Welfare', 'Stationary', 'Subscription',
  'Telco', 'Welfare',
] as const;

export const CUR_INFO: Record<string, CurrencyInfo> = {
  USD: { flag: '\u{1F1FA}\u{1F1F8}', color: '#38bdf8' },
  CNY: { flag: '\u{1F1E8}\u{1F1F3}', color: '#f97316' },
  SGD: { flag: '\u{1F1F8}\u{1F1EC}', color: '#a78bfa' },
  EUR: { flag: '\u{1F1EA}\u{1F1FA}', color: '#fb7185' },
  GBP: { flag: '\u{1F1EC}\u{1F1E7}', color: '#facc15' },
  MYR: { flag: '\u{1F1F2}\u{1F1FE}', color: '#10b981' },
};

export const DESC_BY_CAT: Record<string, string[]> = {
  'Advertisement': ['FB ads', 'Google ads', 'Gym FB ads', 'Gym Google ads', 'Swimming FB ads', 'Swimming Google ads', 'Tiktok ads'],
  'Subscription': ['FB Verified service', 'Google Drive', 'Gym Youtube Premium', 'Capcut pro subscription', 'PDF editor', 'AI agent', 'FB AI chatbot', 'Gym FB AI chatbot', 'Swimming FB AI chatbot'],
  'Telco': ['Center internet service', 'Gym internet service', 'Center and director phone bill', 'Center phone bill', 'Director phone bill', 'Hostel wifi service', 'XHS phone data service'],
  'Marketing': ['Artwork design service', 'Branding colour guide', 'Gym logo design', 'Gym web design', 'Marketing service', 'Tiktok KOC video shooting', 'XHS KOC video', 'KOC recruitment service', 'Booth event flyer printing'],
  'Purchasing': ['Gym equipment', 'Gym pilates equipment', 'Gym sauna equipment', 'Gym ice bath machine', 'Gym lighting', 'Gym toilet lighting', 'Gym light bulb', 'Gym hair dryer bracket', 'Gym hand soap bottle', 'Gym toilet paper', 'Center furniture', 'Office equipment', 'Director laptop', 'Marketing laptop', 'Gym PC set', 'keyboard mouse set', 'A4 paper', 'Pool decking liner', 'Swimming pool heater'],
  'Shipping': ['Shipping fee', 'Gym item shipping fee', 'Gym pilates equipment shipping fee', 'Gym sauna equipment shipping fee', 'Gym ice bath machine shipping fee', 'Office equipment shipping fee', 'Center furniture shipping', 'Heater shipping fee', 'Event booth item shipping fee'],
  'Maintenance': ['Gym equipment maintenance', 'Gym equipment replacement part', 'Center pc repair', 'Cleaning service'],
  'Renovation': ['Gym internet installation', 'Lighting part for renovation', 'BT shoplot TNB deposit'],
  'HR': ['Management course', 'PT training sponsorship for staff', 'MRI claim', 'Payroll system renewal'],
  'Recruitment': ['KOC recruitment service', 'JOb hiring ads', 'recruitment ad'],
  'Staff Welfare': ['Hostel wifi service', 'Dinner', 'Marketing team lunch treat', 'Lunch treat for staff after event'],
  'Welfare': ['Dinner', 'Flower stand for Cedric', 'Lunch treat for staff after event'],
  'Stationary': ['A4 paper', 'Office stationary', 'Gym attendance card', 'Gym printer ink', 'Center printer ink'],
  'Sanitary': ['Gym toilet paper', 'Gym hand soap bottle', 'Gym shower soap dispenser', 'Sanitory refill'],
  'Others': ['TTPM online registration charge', 'Competitor SSM report purchase', 'Gym business trip flight', 'Gym business trip hotel'],
};

export const ALL_DESC = [...new Set(Object.values(DESC_BY_CAT).flat())].sort();

export const SUPPLIERS = [
  'GOOGLE ASIA PACIFIC PTE LTD', 'META PLATFORMS IRELAND LIMITED',
  'CELCOM MOBILE SDN BHD', 'CELCOMDIGI TELECOMMUNICATION SDN BHD',
  'TM TECHNOLOGY SERVICES SDN BHD', 'MAXIS BROADBAND SDN BHD',
  'DIGI TELECOMMUNICATIONS SDN BHD', 'ADOBE SYSTEMS SOFTWARE IRELAND LTD',
  'APPLE MALAYSIA SDN BHD', 'ARTSCAPE ADVERTISING DESIGN STUDIO',
  'AGENSI PEKERJAAN JOBSTREET.COM SDN BHD', 'BUYMALL SERVICES SDN BHD',
  '200 LABS, INC', 'BEANSTALK SOLUTIONS SDN BHD',
  'C&L LIGHTING M SDN BHD', 'BECON ENTERPRISE SDN BHD',
];

export const CHART_COLORS = [
  '#4f6ef7', '#10b981', '#f97316', '#38bdf8', '#a78bfa',
  '#fb7185', '#facc15', '#34d399', '#818cf8', '#f87171',
  '#06b6d4', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b',
];

export const BANK_LABELS: Record<string, string> = {
  maybank: 'Maybank', mbb: 'MBB', cimb: 'CIMB', publicbank: 'Public Bank',
  public_bank: 'Public Bank', rhb: 'RHB', hongleong: 'Hong Leong',
  hong_leong: 'Hong Leong', ambank: 'AmBank', ocbc: 'OCBC', hsbc: 'HSBC',
  uob: 'UOB', bsn: 'BSN', wechat_pay: 'WeChat Pay', generic: 'CC', pdf_text: 'CC',
};
