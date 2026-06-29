import { LUNAR_NEW_YEAR, ZODIAC_ANIMALS, ZODIAC_RANGES } from '../data/calendar-data.js';
import { CITY_MAP, PROVINCE_MAP, SPECIAL_REGION_CODES } from '../data/region-data.js';
import { formatAncestralHome } from '../utils/format-ancestral-home.js';

// 身份证基础解析器：负责 18 位号码的格式校验、校验码验证、地区代码与出生信息提取。
// 校验算法依据 GB 11643-1999：前 17 位按权重加权求和后对 11 取模，结果映射到末位校验码。
export class IDCardParser {
    // 前 17 位每一位的加权因子，用于 ISO 7064:1983 (MOD 11-2) 校验码计算
    static CHECK_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    // 加权和模 11 后查表得到的校验码（数字 10 用 'X' 表示）
    static CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

    constructor(rawId) {
        this.rawId = (rawId || '').trim().toUpperCase();
        this._valid = false;
        this._error = '';
        this._provinceCode = '';
        this._cityCode = '';
        this._countyCode = '';
        this._birthDate = null;
        this._genderCode = -1;
        this._parse();
    }

    _parse() {
        const id = this.rawId;
        if (id.length !== 18) {
            this._error = '身份证号码必须为18位';
            return;
        }
        if (!/^\d{17}[\dX]$/.test(id)) {
            this._error = '身份证号码格式不正确（前17位为数字，第18位为数字或X）';
            return;
        }

        // 加权求和后对 11 取模，结果对应 CHECK_CODES 表中的预期校验码
        let sum = 0;
        for (let i = 0; i < 17; i += 1) {
            sum += parseInt(id[i], 10) * IDCardParser.CHECK_WEIGHTS[i];
        }
        if (IDCardParser.CHECK_CODES[sum % 11] !== id[17]) {
            this._error = '身份证号码校验码不正确，请检查输入';
            return;
        }

        // 第 7-14 位是出生日期 YYYYMMDD；用 Date 反向校验，可拦截 2 月 30 日等非法日期
        const year = parseInt(id.substring(6, 10), 10);
        const month = parseInt(id.substring(10, 12), 10);
        const day = parseInt(id.substring(12, 14), 10);
        const date = new Date(year, month - 1, day);
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
            this._error = '身份证中的出生日期不合法';
            return;
        }
        if (year < 1900 || year > new Date().getFullYear()) {
            this._error = '身份证中的出生年份不在合理范围内';
            return;
        }

        // 地址码分层：前 2 位省级、前 4 位市级、前 6 位区县级
        this._provinceCode = id.substring(0, 2);
        this._cityCode = id.substring(0, 4);
        this._countyCode = id.substring(0, 6);

        // 港澳台（71/81/82/83）不在 PROVINCE_MAP 标准映射中，需走特殊地区分支放行
        const provinceExists = PROVINCE_MAP[this._provinceCode];
        const isSpecial = SPECIAL_REGION_CODES.includes(this._provinceCode);
        if (!provinceExists && !isSpecial) {
            this._error = '身份证号码中的地区代码不合法';
            return;
        }

        this._birthDate = date;
        // 第 17 位为顺序码，奇数为男、偶数为女
        this._genderCode = parseInt(id[16], 10);
        this._valid = true;
    }

    isValid() { return this._valid; }
    getError() { return this._error; }
    getProvinceCode() { return this._provinceCode; }
    getCityCode() { return this._cityCode; }
    getCountyCode() { return this._countyCode; }
    getBirthDate() { return this._birthDate; }
    getGenderCode() { return this._genderCode; }

    getProvinceName() {
        return PROVINCE_MAP[this._provinceCode] || '未知省份';
    }

    getCityName() {
        return CITY_MAP[this._cityCode] || '';
    }

    // 拼接籍贯显示文本。针对四个直辖市（11/12/31/50）做特殊处理：
    // 直辖市的省名与市名相同，因此优先展示省 + 区县，避免出现"上海市 上海市"的重复。
    getFullAncestralHome(resolvedLocation = {}) {
        const provinceName = this.getProvinceName();
        if (resolvedLocation.provinceOnly) return provinceName;

        return formatAncestralHome({
            provinceCode: this._provinceCode,
            provinceName,
            cityName: resolvedLocation.cityName || this.getCityName(),
            countyName: resolvedLocation.countyName || '',
        });
    }
}

// 在基础解析器之上扩展星座、生肖、性别等衍生信息，用于信息卡片展示
export class PersonalInfo extends IDCardParser {
    getZodiacSign() {
        const birthDate = this.getBirthDate();
        if (!birthDate) return null;

        const month = birthDate.getMonth() + 1;
        const day = birthDate.getDate();
        // 把月日合成单一整数 MMDD 便于范围比较
        const md = month * 100 + day;

        for (const zodiac of ZODIAC_RANGES) {
            const [startMonth, startDay] = zodiac.start;
            const [endMonth, endDay] = zodiac.end;
            const start = startMonth * 100 + startDay;
            const end = endMonth * 100 + endDay;
            if (start <= end) {
                if (md >= start && md <= end) return zodiac.name;
            } else if (md >= start || md <= end) {
                // 跨年份的星座（摩羯座 12/22 - 1/19）需要拆成两段判断
                return zodiac.name;
            }
        }

        return '未知';
    }

    getGender() {
        const genderCode = this.getGenderCode();
        if (genderCode < 0) return '未知';
        return genderCode % 2 === 1 ? '男' : '女';
    }

    // 生肖按农历年划分。在春节之前出生的人属于上一年的生肖，
    // 因此需要比对 LUNAR_NEW_YEAR 表得到正确的生肖年份。
    getChineseZodiac() {
        const birthDate = this.getBirthDate();
        if (!birthDate) return null;

        const year = birthDate.getFullYear();
        const month = birthDate.getMonth() + 1;
        const day = birthDate.getDate();
        let zodiacYear = year;
        const springFestival = LUNAR_NEW_YEAR[year];

        if (springFestival) {
            // 出生日期早于该年春节，则归入上一年
            if (month < springFestival[0] || (month === springFestival[0] && day < springFestival[1])) {
                zodiacYear = year - 1;
            }
        } else if (month < 2 || (month === 2 && day < 4)) {
            // 表外年份按 2 月 4 日（立春）做近似分界，作为兜底
            zodiacYear = year - 1;
            if (year > 2030) {
                console.warn(`农历春节数据仅覆盖至 2030 年，${year} 年生肖使用立春近似推算，结果可能与实际差 1-2 天`);
            }
        }

        // 生肖周期 12 年，公元 4 年为鼠年起点；用 ((x % 12) + 12) % 12 兼容负数
        const index = ((zodiacYear - 4) % 12 + 12) % 12;
        return ZODIAC_ANIMALS[index];
    }

    getSummary(resolvedLocation = {}) {
        return {
            ancestralHome: this.getFullAncestralHome(resolvedLocation),
            zodiacSign: this.getZodiacSign() || '——',
            gender: this.getGender(),
            chineseZodiac: this.getChineseZodiac() || '——',
            provinceCode: this.getProvinceCode(),
            cityCode: this.getCityCode(),
            countyCode: this.getCountyCode(),
            provinceName: this.getProvinceName(),
            cityName: resolvedLocation.cityName || this.getCityName(),
            countyName: resolvedLocation.countyName || '',
            birthDate: this.getBirthDate(),
        };
    }
}
