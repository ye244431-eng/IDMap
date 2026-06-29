import assert from 'node:assert/strict';
import { PersonalInfo } from '../scripts/core/parser.js';
import { MapLocator } from '../scripts/core/map-locator.js';
import { getExtendedLocation, getExtendedLocationGroup } from '../scripts/data/extended-location-data.js';
import { getProvinceCodeByName, PROVINCE_MAP, SPECIAL_REGION_CODES } from '../scripts/data/region-data.js';
import { formatAncestralHome } from '../scripts/utils/format-ancestral-home.js';

function buildId(areaCode, birthDate, sequenceCode) {
    const body = `${areaCode}${birthDate}${sequenceCode}`;
    const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    const codes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
    const sum = [...body].reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
    return `${body}${codes[sum % 11]}`;
}

function testParser() {
    const person = new PersonalInfo('110101199003077512');
    assert.equal(person.isValid(), true);
    assert.equal(person.getProvinceCode(), '11');
    assert.equal(person.getCityCode(), '1101');
    assert.equal(person.getCountyCode(), '110101');
    assert.equal(person.getGenderCode(), 1);
    assert.equal(person.getBirthDate().getFullYear(), 1990);

    const invalidChecksum = new PersonalInfo('110101199003077513');
    assert.equal(invalidChecksum.isValid(), false);
    assert.ok(invalidChecksum.getError());

    const invalidDate = new PersonalInfo(buildId('110101', '19990231', '001'));
    assert.equal(invalidDate.isValid(), false);
    assert.ok(invalidDate.getError());

    const shenzhenPerson = new PersonalInfo('440305199208124514');
    assert.equal(shenzhenPerson.getSummary({ provinceOnly: true }).ancestralHome, '广东省');
    assert.equal(shenzhenPerson.getSummary().ancestralHome, '广东省 深圳市');
    assert.equal(shenzhenPerson.getSummary({ cityName: '深圳市', countyName: '南山区' }).ancestralHome, '广东省 深圳市');
    assert.equal(person.getSummary().ancestralHome, '北京市');
    assert.equal(
        person.getSummary({ cityName: '北京市', countyName: '东城区' }).ancestralHome,
        '北京市 东城区'
    );
}

function testInvalidProvinceCode() {
    const invalidProvince = new PersonalInfo(buildId('990101', '19900307', '001'));
    assert.equal(invalidProvince.isValid(), false);
    assert.equal(invalidProvince.getError(), '身份证号码中的地区代码不合法');

    const invalidProvince2 = new PersonalInfo(buildId('000101', '19900307', '001'));
    assert.equal(invalidProvince2.isValid(), false);
}

function testSpecialRegions() {
    const hkPerson = new PersonalInfo(buildId('810000', '19900307', '001'));
    assert.equal(hkPerson.isValid(), true);
    assert.equal(hkPerson.getProvinceCode(), '81');
    assert.equal(hkPerson.getProvinceName(), '香港特别行政区');
    assert.ok(SPECIAL_REGION_CODES.includes('81'));

    const macauPerson = new PersonalInfo(buildId('820000', '19900307', '001'));
    assert.equal(macauPerson.isValid(), true);
    assert.equal(macauPerson.getProvinceName(), '澳门特别行政区');

    const twPerson = new PersonalInfo(buildId('710000', '19900307', '001'));
    assert.equal(twPerson.isValid(), true);
    assert.equal(twPerson.getProvinceName(), '台湾省');

    const twAltPerson = new PersonalInfo(buildId('830000', '19900307', '001'));
    assert.equal(twAltPerson.isValid(), true);
    assert.equal(twAltPerson.getProvinceName(), '台湾省');
}

function testMunicipalityFormatting() {
    const beijingPerson = new PersonalInfo('110101199003077512');
    assert.equal(beijingPerson.getSummary().ancestralHome, '北京市');
    assert.equal(
        beijingPerson.getSummary({ cityName: '北京市', countyName: '东城区' }).ancestralHome,
        '北京市 东城区'
    );

    const shanghaiPerson = new PersonalInfo('310115198807104118');
    assert.equal(shanghaiPerson.getProvinceName(), '上海市');
    assert.equal(shanghaiPerson.getSummary().ancestralHome, '上海市');

    const chongqingPerson = new PersonalInfo('500103199805201234');
    assert.equal(chongqingPerson.getProvinceName(), '重庆市');
    assert.ok(chongqingPerson.isValid());
}

function testExtendedLocations() {
    const hongKongGroup = getExtendedLocationGroup('81');
    assert.ok(hongKongGroup);
    assert.ok(hongKongGroup.locations.length > 0);

    const shaTin = getExtendedLocation('81', 'sha-tin');
    assert.equal(shaTin.id, 'sha-tin');
    assert.deepEqual(shaTin.center, [114.1950, 22.3790]);

    const fallback = getExtendedLocation('81', 'not-exists');
    assert.equal(fallback.id, hongKongGroup.defaultId);
    assert.equal(getExtendedLocation('99', 'anything'), null);
    assert.equal(getExtendedLocationGroup('83'), getExtendedLocationGroup('71'));
}

function testRegionData() {
    assert.equal(getProvinceCodeByName('广东省'), '44');

    for (const code of Object.keys(PROVINCE_MAP)) {
        const name = PROVINCE_MAP[code];
        const resolved = getProvinceCodeByName(name);
        assert.ok(resolved, `Cannot resolve province code for ${name}`);
    }
}

function testMapLocator() {
    const locator = new MapLocator();
    const nationalGeoJson = {
        features: [{
            properties: { name: 'Example Province', adcode: '440000', center: [113, 23] },
            geometry: { coordinates: [[[112, 22], [114, 22], [114, 24], [112, 24]]] },
        }],
    };
    assert.deepEqual(locator.getProvinceCenter(nationalGeoJson, 'Example Province'), [113, 23]);

    const provinceGeoJson = {
        features: [{
            properties: { name: 'Example City', adcode: '440300' },
            geometry: { coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2]]] },
        }],
    };
    const summary = { provinceCode: '44', cityCode: '4403', countyCode: '440305' };
    const resolved = locator.resolveLocationFromProvince(summary, provinceGeoJson);
    assert.deepEqual(resolved, { cityName: 'Example City', countyName: '' });
    assert.equal(locator.matchProvinceFeature(summary, provinceGeoJson, resolved).properties.name, 'Example City');
    assert.deepEqual(locator.computeGeoJSONCenter(provinceGeoJson), [1, 1]);

    const districtGeoJson = {
        features: [{ properties: { name: 'Example District', adcode: '110101' } }],
    };
    const districtSummary = { provinceCode: '11', cityCode: '1101', countyCode: '110101' };
    assert.equal(locator.matchDistrictFeature(districtSummary, districtGeoJson).properties.name, 'Example District');
}

function testLocatorEdgeCases() {
    const locator = new MapLocator();

    assert.equal(locator.getProvinceCenter({ features: [] }, 'Nonexistent'), null);
    assert.equal(locator.getProvinceCenter(null, 'Anything'), null);
    assert.equal(locator.getFeatureCenter(null), null);
    assert.equal(locator.getFeatureCenter({ properties: {} }), null);
    assert.deepEqual(locator.resolveLocationFromProvince({ cityCode: '4403' }, null), { cityName: '', countyName: '' });
    assert.deepEqual(locator.resolveLocationFromProvince({ cityCode: '4403' }, { features: [] }), { cityName: '', countyName: '' });

    const centerFromCentroid = locator.getFeatureCenter({
        properties: { centroid: [120, 30] },
        geometry: { type: 'Point', coordinates: [120, 30] },
    });
    assert.deepEqual(centerFromCentroid, [120, 30]);

    const centerFromPolygon = locator.getFeatureCenter({
        geometry: { coordinates: [[[[0, 0], [2, 0], [2, 2], [0, 2]]]] },
    });
    assert.deepEqual(centerFromPolygon, [1, 1]);

    const multiPolygonCenter = locator.computeGeoJSONCenter({
        features: [
            { geometry: { coordinates: [[[[0, 0], [2, 0], [2, 2], [0, 2]]]] } },
            { geometry: { coordinates: [[[[2, 2], [4, 2], [4, 4], [2, 4]]]] } },
        ],
    });
    assert.deepEqual(multiPolygonCenter, [2, 2]);

    assert.deepEqual(locator.collectGeometryPoints(null), []);
    assert.deepEqual(locator.collectGeometryPoints({}), []);
    assert.deepEqual(locator.collectGeometryPoints({ coordinates: null }), []);
    assert.deepEqual(locator.collectGeometryPoints({ coordinates: [null, {}, 'bad'] }), []);
    assert.equal(locator.getFeatureCenter({ geometry: { coordinates: null } }), null);
    assert.equal(locator.computeGeoJSONCenter({ features: [{ geometry: { coordinates: null } }] }), null);
    assert.equal(locator.computeGeoJSONCenter({ features: [{ geometry: null }] }), null);
}

function testParserEdgeCases() {
    const emptyPerson = new PersonalInfo('');
    assert.equal(emptyPerson.isValid(), false);

    const shortPerson = new PersonalInfo('1101011990');
    assert.equal(shortPerson.isValid(), false);
}

function testFormatAncestralHome() {
    // 普通省份 + 城市
    assert.equal(formatAncestralHome({
        provinceCode: '44', provinceName: '广东省', cityName: '深圳市', countyName: '',
    }), '广东省 深圳市');

    // 直辖市：省名 === 市名时省略重复
    assert.equal(formatAncestralHome({
        provinceCode: '11', provinceName: '北京市', cityName: '北京市', countyName: '',
    }), '北京市');

    // 直辖市 + 区县
    assert.equal(formatAncestralHome({
        provinceCode: '11', provinceName: '北京市', cityName: '北京市', countyName: '东城区',
    }), '北京市 东城区');

    // 直辖市 + 市名不同于省名
    assert.equal(formatAncestralHome({
        provinceCode: '50', provinceName: '重庆市', cityName: '重庆市', countyName: '渝中区',
    }), '重庆市 渝中区');

    // 普通省份 + 区县（无城市名时）
    assert.equal(formatAncestralHome({
        provinceCode: '44', provinceName: '广东省', cityName: '', countyName: '南山区',
    }), '广东省 南山区');

    // 仅省份
    assert.equal(formatAncestralHome({
        provinceCode: '65', provinceName: '新疆维吾尔自治区', cityName: '', countyName: '',
    }), '新疆维吾尔自治区');
}

testParser();
testInvalidProvinceCode();
testSpecialRegions();
testMunicipalityFormatting();
testExtendedLocations();
testRegionData();
testMapLocator();
testLocatorEdgeCases();
testParserEdgeCases();
testFormatAncestralHome();

console.log('All tests passed');
