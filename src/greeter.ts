class Employee{
    fullname: string;

    constructor(public firstName: string, public middleName: string, public lastName: string){
        this.fullname = firstName + middleName + lastName
    }
}


interface Greet{
    firstName: string,
    lastName: string
}

function greeter(person: Greet){
    console.log("Hello! My name is " + person.firstName, " and Age is: " + person.lastName);
}

let user= new Employee("Christiana", "Marie", "Gimenez");

greeter(user); //case sensitive

// --------------------------------------------------------------------
//test
// --------------------------------------------------------------------

let helloWorld = "Hello World";

// console.log(helloWorld);
//  ^?


const myCar: Car = {
    model: "Avanza",
    chasis_no: "90989",
    model_no: "2018",
    car_name: "Toyota"
}

// console.log(myCar);

// interface User {
//   name: string;
//   id: number;
// }



interface Car{
    model: string;
    chasis_no: string;
    model_no: string;
    car_name: string
}


class TypeOfCars{
    car_name: string;
    chasis_no: string;
    model_no: string;
    model: string;

    constructor(car_name: string, model: string, chasis_no: string, model_no: string){
        this.car_name = car_name;
        this.model = model;
        this.chasis_no = chasis_no;
        this.model_no = model_no;
    }
}

const car1: Car  = new TypeOfCars("Honda", "City", "2018-78687", "2018");

// console.log(new TypeOfCars("Honda", "City", "2018-78687", "2018"));
// const user: User = {
//   username: "Hayes",
//   id: 0,
// };

function getCars(obj: object | object[]){
    if(typeof obj === "object"){
        console.log("getCars typeof is: ", obj);
    }
}

function deleteCars(car: Car){
    console.log("delete this:", car);
} 

// deleteCars(car1);


let arrayOfCar: Array<Car> = [new TypeOfCars("Toyota", "Avanza", "2019-78687", "2020"), new TypeOfCars("Honda", "City", "2018-78687", "2018")] 
 


// console.log(getCars(arrayOfCar));
// console.log(typeof arrayOfCar);


// console.log(user.username);


type MyBool = true | false;

//unions
type WindowStates = "open" | "closed" | "minimized";
type LockStates = "locked" | "unlocked";
type PositiveOddNumbersUnderTen = 1 | 3 | 5 | 7 | 9;


// generics
type StringArray = Array<string>;
type NumberArray = Array<number>;
type ObjectWithNameArray = Array<{ name: string }>;

//not working -----------------------------------------------------------------------------
// car array

interface CarArray<Type>{
    add: (car_name: string, chasis_no: string, model_no: string, model: string) => void;
    get: () => Type;
}

declare let cars: CarArray<Object>;


// const car_1 = cars.get();

// cars.add("Toyota", "Avanza", "2019-78687", "2020");
// cars.add("Honda", "City", "2018-78687", "2018");

// console.log("All Cars: ", car_1);
// console.log("Cars typeof ", typeof cars);
//not working -----------------------------------------------------------------------------

interface Point{
    x: number,
    y: number
}

function logPoint(p: Point){
    console.log(`logPoint ${p.x}, ${p.y}`);
};

const point = {x: 1, y: 2}
const point3 = {x: 2020, z: 2021, y: 2022}
// const wrong = {width: 9, height: 10}

// logPoint(point);
// logPoint(point3);

//-------------------------------------
class Employee{
    fullname: string;

    constructor(public firstName: string, public middleName: string, public lastName: string){
        this.fullname = firstName + middleName + lastName
    }
}


interface Greet{
    firstName: string,
    lastName: string
}

function greeter(person: Greet){
    console.log("Hello! My name is " + person.firstName.toUpperCase(), " and lastname is: " + person.lastName.toLowerCase());
}

let user= new Employee("Christiana", "Marie", "Gimenez");

greeter(user); //case sensitive


function flipCoin(){
    return Math.random() > 0.5;
}


// console.log(flipCoin())


function greet(person: string, date: Date) {
  console.log(`Hello ${person}, today is ${date.toDateString()}!`);
}
 
greet("Christiana", new Date);

function compare(a: number, b: number): -1 | 0 | 1 {
  return a === b ? 0 : a > b ? 1 : -1;
}

console.log(compare(5,1));
